import path from "node:path";
import ts from "typescript";

export type ProjectDiagnostic = {
  filePath: string;
  line: number;
  column: number;
  message: string;
};

export const getProjectConfiguration = (projectPath: string) => {
  const configPath = ts.findConfigFile(projectPath, ts.sys.fileExists);
  if (!configPath)
    return {
      diagnostics: [
        {
          filePath: "<N/A>",
          line: -1,
          column: -1,
          message: "No tsconfig.json found",
        },
      ] as ProjectDiagnostic[],
    };

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    return {
      diagnostics: [
        {
          filePath: configPath,
          line: configFile.error.start ?? -1,
          column: configFile.error.start ?? -1,
          message: ts.flattenDiagnosticMessageText(
            configFile.error.messageText,
            "\n",
          ),
        },
      ],
    };
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath,
  );

  const diagnostics: ProjectDiagnostic[] = [];

  diagnostics.push(
    ...parsedConfig.errors.map((error) => ({
      filePath: path.relative(projectPath, error.file?.fileName ?? configPath),
      line: error.start ?? -1,
      column: -1,
      message: ts.flattenDiagnosticMessageText(error.messageText, "\n"),
    })),
  );

  return {
    config: parsedConfig,
    diagnostics,
  };
};

export const getTypescriptProgram = (projectPath: string) => {
  const { config, diagnostics } = getProjectConfiguration(projectPath);
  if (!config) return { program: undefined, diagnostics };

  const program = ts.createProgram({
    rootNames: config.fileNames,
    options: config.options,
  });

  return { program, diagnostics };
};

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

export const getMainFunctions = (program: ts.Program) => {
  const mainFunctions: Map<ts.Symbol, readonly ts.Signature[]> = new Map();
  const checker = program.getTypeChecker();
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes("node_modules")) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;
    const exports = checker.getExportsOfModule(moduleSymbol);
    for (const exp of exports) {
      if (exp.name === "main" && exp.valueDeclaration) {
        const type = checker.getTypeOfSymbolAtLocation(
          exp,
          exp.valueDeclaration,
        );
        if (type.getCallSignatures().length > 0) {
          mainFunctions.set(exp, type.getCallSignatures());
        }
      }
    }
  }
  return mainFunctions;
};

export const findHttpRequestAndResponseImports = (program: ts.Program) => {
  const imports: {
    HttpRequest: ts.Type | undefined;
    HttpResponse: ts.Type | undefined;
  } = {
    HttpRequest: undefined,
    HttpResponse: undefined,
  };
  const checker = program.getTypeChecker();
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes("node_modules")) continue;
    ts.forEachChild(sourceFile, (node) => {
      if (
        ts.isImportDeclaration(node) &&
        node.moduleSpecifier.getText().includes("'chasb/http'")
      ) {
        const importClause = node.importClause;
        if (
          importClause &&
          importClause.namedBindings &&
          ts.isNamedImports(importClause.namedBindings)
        ) {
          for (const element of importClause.namedBindings.elements) {
            const symbol = checker.getSymbolAtLocation(element.name);
            if (element.name.text === "HttpRequest")
              imports.HttpRequest = symbol
                ? checker.getTypeOfSymbolAtLocation(symbol, element.name)
                : undefined;
            if (element.name.text === "HttpResponse")
              imports.HttpResponse = symbol
                ? checker.getTypeOfSymbolAtLocation(symbol, element.name)
                : undefined;
          }
        }
      }
    });
  }
  return imports;
};

export const getHttpRequestAndResponseSymbols = (checker: ts.TypeChecker) => {
  const moduleSymbol = checker
    .getAmbientModules()
    .find((symbol) => symbol.getName().includes("'chasb/http'"));
  if (!moduleSymbol) return { HttpRequest: undefined, HttpResponse: undefined };
  const exports = checker.getExportsOfModule(moduleSymbol);
  const HttpRequest = exports.find((exp) => exp.name === "HttpRequest");
  const HttpResponse = exports.find((exp) => exp.name === "HttpResponse");
  return { HttpRequest, HttpResponse };
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
  const targetSignatureDiagnostics = callSignatures.map((signature) => {
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
      if (!checker.isTypeAssignableTo(returnType, httpSymbols.HttpResponse))
        return false;
      if (!checker.isTypeAssignableTo(httpSymbols.HttpResponse, returnType))
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
  });
  return targetSignatureDiagnostics;
};

export const validateImports = (
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

export const validateTypescriptProject = (project: ts.Program) => {
  const diagnostics: ProjectDiagnostic[] = [];
  const allowedImports = [
    "chasb/logging",
    "chasb/random",
    "chasb/config",
    "chasb/crypto",
    "chasb/http",
    "chasb/time",
    "chasb/fs",
    "chasb/db",
  ];
  const projectPath = project.getCurrentDirectory();
  const checker = project.getTypeChecker();
  for (const sourceFile of project.getSourceFiles()) {
    if (!sourceFile.isDeclarationFile) {
      diagnostics.push(
        ...validateImports(sourceFile, checker, allowedImports, projectPath),
      );
      diagnostics.push(...checkRequireAndImportNodes(sourceFile, projectPath));
    }
  }
  return diagnostics;
};
