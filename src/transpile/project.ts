import path from "node:path";
import ts from "typescript";
import type { ProjectDiagnostic } from "./helper.js";

export const getProjectConfiguration = (projectPath: string) => {
  projectPath = path.resolve(projectPath);
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
  const checker = program.getTypeChecker();

  const findGlobalType = (name: string) => {
    const symbol = checker.resolveName(
      name,
      undefined,
      ts.SymbolFlags.Type,
      false,
    );
    return symbol ? checker.getDeclaredTypeOfSymbol(symbol) : undefined;
  };

  const imports: {
    HttpRequest: ts.Type | undefined;
    HttpResponse: ts.Type | undefined;
  } = {
    HttpRequest: findGlobalType("Request"),
    HttpResponse: findGlobalType("Response"),
  };
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
