import path from "node:path";
import ts from "typescript";
import type { ProjectDiagnostic } from "./helper.js";
import {
  findHttpRequestAndResponseImports,
  getMainFunctions,
} from "./project.js";

export const validateSynaxAndSemantics = (program: ts.Program) => {
  const diagnostics: ProjectDiagnostic[] = [];

  const syntacticDiagnostics = program.getSyntacticDiagnostics();
  diagnostics.push(
    ...syntacticDiagnostics.map((error) => ({
      filePath: error.file?.fileName ?? "<N/A>",
      line: error.start ?? -1,
      column: -1,
      message: ts.flattenDiagnosticMessageText(error.messageText, "\n"),
    })),
  );

  const semanticDiagnostics = program.getSemanticDiagnostics();
  diagnostics.push(
    ...semanticDiagnostics.map((error) => ({
      filePath: error.file?.fileName ?? "<N/A>",
      line: error.start ?? -1,
      column: -1,
      message: ts.flattenDiagnosticMessageText(error.messageText, "\n"),
    })),
  );

  return diagnostics;
};

export const checkParameterAndReturnTypeOfMain = (
  mainFunction: ts.Symbol,
  callSignatures: readonly ts.Signature[],
  checker: ts.TypeChecker,
  httpSymbols: { HttpRequest: ts.Type; HttpResponse: ts.Type },
  projectPath: string,
) => {
  if (!mainFunction.valueDeclaration) {
    throw new Error(
      "A `main` function with falsy value declaration passed to `checkParameterAndReturnTypeOfMain`",
    );
  }
  if (callSignatures.length === 0) {
    throw new Error(
      "A `main` function with no call signatures passed to `checkParameterAndReturnTypeOfMain`",
    );
  }
  const sourceFile = mainFunction.valueDeclaration.getSourceFile();
  const targetSignatureDiagnostics = callSignatures.flatMap((signature) => {
    const diagnostics: ProjectDiagnostic[] = [];
    const isArgumentTypeProper = (() => {
      if (signature.parameters.length !== 1) return false;
      const parameterType = checker.getTypeOfSymbolAtLocation(
        signature.parameters[0],
        mainFunction.valueDeclaration!,
      );
      if (!parameterType) return false;
      if (!checker.isTypeAssignableTo(parameterType, httpSymbols.HttpRequest))
        return false;
      if (!checker.isTypeAssignableTo(httpSymbols.HttpRequest, parameterType))
        return false;
      return true;
    })();

    if (!isArgumentTypeProper) {
      const { line, character: column } =
        sourceFile.getLineAndCharacterOfPosition(
          mainFunction.valueDeclaration!.getStart(),
        );
      diagnostics.push({
        message:
          "`main` function must have exactly one parameter of type `HttpRequest`.",
        filePath: path.relative(projectPath, sourceFile.fileName),
        line,
        column,
      });
    }
    const isReturnTypeProper = (() => {
      const returnType = checker.getReturnTypeOfSignature(signature);
      if (!returnType) return false;
      const awaitedReturnType =
        checker.getAwaitedType(returnType) ?? returnType;
      if (
        !checker.isTypeAssignableTo(awaitedReturnType, httpSymbols.HttpResponse)
      )
        return false;
      if (
        !checker.isTypeAssignableTo(httpSymbols.HttpResponse, awaitedReturnType)
      )
        return false;
      return true;
    })();
    if (!isReturnTypeProper) {
      const { line, character: column } =
        sourceFile.getLineAndCharacterOfPosition(
          mainFunction.valueDeclaration!.getStart(),
        );
      diagnostics.push({
        message:
          "`main` function must have a return type of `HttpResponse|Promise<HttpResponse>`.",
        filePath: path.relative(projectPath, sourceFile.fileName),
        line,
        column,
      });
    }
    return diagnostics;
  });
  return targetSignatureDiagnostics;
};

export const validateModuleImports = (
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  allowedImports: string[],
  projectPath: string,
): ProjectDiagnostic[] => {
  const diagnostics: ProjectDiagnostic[] = [];
  const importStatements = sourceFile.statements.filter(ts.isImportDeclaration);
  for (const importStatement of importStatements) {
    const moduleSpecifier = importStatement.moduleSpecifier;
    if (ts.isStringLiteral(moduleSpecifier)) {
      const importPath = moduleSpecifier.text;
      if (!allowedImports.includes(importPath)) {
        const { line, character: column } =
          sourceFile.getLineAndCharacterOfPosition(importStatement.getStart());
        diagnostics.push({
          message: `Import from "${importPath}" is not allowed.`,
          filePath: path.relative(projectPath, sourceFile.fileName),
          line,
          column,
        });
      }
    } else {
      const { line, character: column } =
        sourceFile.getLineAndCharacterOfPosition(importStatement.getStart());
      diagnostics.push({
        message: `Import from a non-string module specifier is not allowed.`,
        filePath: path.relative(projectPath, sourceFile.fileName),
        line,
        column,
      });
    }
  }
  return diagnostics;
};

export const checkRequireAndImportNodes = (
  sourceFile: ts.SourceFile,
  projectPath: string,
): ProjectDiagnostic[] => {
  const diagnostics: ProjectDiagnostic[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const { line, character: column } =
          sourceFile.getLineAndCharacterOfPosition(node.getStart());
        diagnostics.push({
          message: "`import` calls are not allowed.",
          filePath: path.relative(projectPath, sourceFile.fileName),
          line,
          column,
        });
      } else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require"
      ) {
        const { line, character: column } =
          sourceFile.getLineAndCharacterOfPosition(node.getStart());
        diagnostics.push({
          message: "`require` calls are not allowed.",
          filePath: path.relative(projectPath, sourceFile.fileName),
          line,
          column,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return diagnostics;
};

export const validateTypescriptProgram = (program: ts.Program) => {
  const diagnostics: ProjectDiagnostic[] = [
    ...validateSynaxAndSemantics(program),
  ];
  const allowedImports = [
    "chasb/logging",
    "chasb/random",
    "chasb/config",
    "chasb/crypto",
    "chasb/http",
    "chasb/jwt",
    "chasb/fs",
    "chasb/db",
  ];
  const projectPath = program.getCurrentDirectory();
  const checker = program.getTypeChecker();
  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceFile.isDeclarationFile) {
      diagnostics.push(
        ...validateModuleImports(
          sourceFile,
          checker,
          allowedImports,
          projectPath,
        ),
      );
      diagnostics.push(...checkRequireAndImportNodes(sourceFile, projectPath));
    }
  }

  const mainFunctions = getMainFunctions(program);

  if (mainFunctions.size !== 1) {
    diagnostics.push({
      message: `There must be exactly one 'main' function exported. ${
        mainFunctions.size
      } main functions were found (
      ${[...mainFunctions.keys()]
        .flatMap((sym) =>
          sym
            .getDeclarations()
            ?.map((decl) =>
              path.relative(projectPath, decl.getSourceFile().fileName),
            ),
        )
        .join(", ")}).`,
      filePath: "<N/A>",
      line: -1,
      column: -1,
    });
  } else {
    const httpSymbols = findHttpRequestAndResponseImports(program);
    if (!httpSymbols.HttpRequest || !httpSymbols.HttpResponse) {
      diagnostics.push({
        message: "Failed to find HTTP request and response imports.",
        filePath: "<N/A>",
        line: -1,
        column: -1,
      });
    } else {
      diagnostics.push(
        ...checkParameterAndReturnTypeOfMain(
          mainFunctions.keys().next().value!,
          mainFunctions.values().next().value!,
          checker,
          httpSymbols as { HttpRequest: ts.Type; HttpResponse: ts.Type },
          projectPath,
        ),
      );
    }
  }
  return diagnostics;
};
