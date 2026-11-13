import path from "node:path";
import ts from "typescript";
import {
  checkDescendants,
  getInternalTypeName,
  getInternalTypePropertySpec,
  Indentation,
  isConstructible,
  isNumber,
  isObjectLiteral,
  isStringLike,
  populateVariableInfo,
  prepareStringValue,
  prepareVariableName,
  updateScope,
  type ScopeSymbolInfo,
} from "./helper.js";

const compileNodeEnsureParentheses = (
  node: ts.Node,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, ScopeSymbolInfo>,
  indentation: Indentation,
): string => {
  const code = compileNode(node, checker, scope, indentation);
  return ts.isLiteralExpression(node) ||
    ts.isIdentifier(node) ||
    ts.isParenthesizedExpression(node)
    ? code
    : `(${code})`;
};

const compileIdentifierNode = (
  node: ts.Identifier,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, ScopeSymbolInfo>,
): string => {
  const symbol = checker.getSymbolAtLocation(node);
  const variableName = symbol && scope.get(symbol)?.name;
  return variableName ? `${variableName}` : node.text;
};

const compileStringLiteralNode = (
  node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral,
): string => prepareStringValue(node.text);

const compileTemplateExpressionNode = (
  node: ts.TemplateExpression,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, ScopeSymbolInfo>,
  indentation: Indentation,
): string => {
  return [
    prepareStringValue(node.head.text),
    ...node.templateSpans.flatMap((span) => {
      const expr = compileNode(span.expression, checker, scope, indentation);
      const literal = span.literal.text;
      return [`(${expr})`, prepareStringValue(literal)];
    }),
  ].join(" . ");
};

const compileVariableDeclarationNode = (
  node: ts.VariableDeclaration,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, ScopeSymbolInfo>,
  indentation: Indentation,
  exported: boolean = false,
) => {
  const getOmittedExpressionVarName = (() => {
    const scopedVariableNames = new Set(
      Array.from(scope.values()).map((v) => v.name),
    );
    let omittedExpressionIndex = 0;

    return () => {
      let result = `$___${omittedExpressionIndex}`;
      while (scopedVariableNames.has(result)) {
        omittedExpressionIndex++;
        result = `$___${omittedExpressionIndex}`;
      }
      return result;
    };
  })();

  const traverseName = (
    name: ts.BindingName,
    propertyName?: string,
  ): string => {
    if (ts.isIdentifier(name)) {
      const rawResult = populateVariableInfo(name, checker);
      if (!rawResult)
        return `${getOmittedExpressionVarName()} /* !UNEXPECTED! */`;
      const [result, symbol, constructible] = rawResult;
      const variableName = constructible
        ? prepareVariableName(result)
        : `$${prepareVariableName(result)}`;
      scope.set(symbol, { name: variableName, referenced: false });
      if (propertyName)
        return `${prepareStringValue(propertyName)} => ${variableName}`;
      return variableName;
    }
    const elements = name.elements
      .map((e) =>
        ts.isOmittedExpression(e)
          ? getOmittedExpressionVarName()
          : traverseName(
              e.name,
              ts.isObjectBindingPattern(name)
                ? (e.propertyName?.getText() ?? e.name.getText())
                : undefined,
            ),
      )
      .join(", ");
    const result = `[ ${elements} ]`;
    return propertyName
      ? `${prepareStringValue(propertyName)} => ${result}`
      : result;
  };

  let exportedName = "";
  if (exported) {
    if (!ts.isIdentifier(node.name)) {
      throw new Error("Exported variable must have an identifier name.");
    }
    exportedName = node.name.text;
  }
  let expression = traverseName(node.name);
  const initializer =
    node.initializer &&
    compileNode(node.initializer, checker, scope, indentation);
  if (!initializer || expression === "") return "";
  return `${exported ? `$exports[${prepareStringValue(exportedName)}] = ` : ""}${expression} = ${initializer}`;
};

const compileParameterNode = (
  node: ts.ParameterDeclaration,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, ScopeSymbolInfo>,
): string => {
  const symbol = checker.getSymbolAtLocation(node.name);
  if (!ts.isIdentifier(node.name)) {
    throw new Error("Parameter name must be an identifier.");
  }
  const name = prepareVariableName(node.name.getText());
  const phpName = name && `$${name}`;
  if (symbol && phpName) {
    scope.set(symbol, { name: phpName, referenced: false });
  }
  return name ? `${phpName}` : "";
};

const compileVariableDeclarationListNode = (
  node: ts.VariableDeclarationList,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, ScopeSymbolInfo>,
  indentation: Indentation,
  exported: boolean = false,
): string => {
  return node.declarations
    .map((decl) =>
      compileVariableDeclarationNode(
        decl,
        checker,
        scope,
        indentation,
        exported,
      ),
    )
    .map((line) => `${indentation.indentation}${line};`)
    .join("\n");
};

const compileVariableStatementNode = (
  node: ts.VariableStatement,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, ScopeSymbolInfo>,
  indentation: Indentation,
): string => {
  const isExported = node.modifiers?.some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword,
  );
  if (isExported && !(node.declarationList.flags & ts.NodeFlags.Const)) {
    throw new Error("Exported variable statements must be const.");
  }
  const declarationList = compileVariableDeclarationListNode(
    node.declarationList,
    checker,
    scope,
    indentation,
    isExported,
  );
  return declarationList;
};

const compileBlockNode = (
  node: ts.Block,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, ScopeSymbolInfo>,
  indentation: Indentation,
): string => {
  const localScope = new Map(
    Array.from(scope.entries()).map(([key, value]) => [
      key,
      { ...value, referenced: false },
    ]),
  );
  indentation.increase();
  const statementIndentation = indentation.indentation;
  const statements = node.statements.map((n) =>
    compileNode(n, checker, localScope, indentation),
  );
  indentation.decrease();
  const referencedSymbols = Array.from(localScope.values()).filter(
    (info) => info.referenced,
  );
  return [
    `${indentation.indentation}{`,
    ...referencedSymbols.map(
      (info) => `${statementIndentation}${info.name} = null;`,
    ),
    ...statements,
    `${indentation.indentation}}`,
  ].join("\n");
};

const compileReturnNode = (
  node: ts.ReturnStatement,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, ScopeSymbolInfo>,
  indentation: Indentation,
): string => {
  const expression = node.expression
    ? ` ${compileNode(node.expression, checker, scope, indentation)}`
    : "";
  return `${indentation.indentation}return${expression};`;
};

const compileFunctionNode = (
  node: ts.FunctionLikeDeclaration | ts.ArrowFunction | ts.FunctionExpression,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, ScopeSymbolInfo>,
  indentation: Indentation,
): string => {
  const localScope = new Map(
    Array.from(scope.entries()).map(([key, value]) => [
      key,
      { ...value, referenced: false },
    ]),
  );
  const name = prepareVariableName(node.name?.getText());
  const async = node.modifiers?.some(
    (m) => m.kind === ts.SyntaxKind.AsyncKeyword,
  );
  let prefix = "";
  if (name !== undefined) {
    const symbol = checker.getSymbolAtLocation(node.name!);
    const phpName = `$${name}`;
    if (symbol) {
      scope.set(symbol, { name: phpName, referenced: false });
      localScope.set(symbol, { name: phpName, referenced: false });
    }
    if (node.kind === ts.SyntaxKind.FunctionDeclaration && name) {
      prefix = `${phpName} = `;
    }
  }
  const parameters = node.parameters.map((p) =>
    compileParameterNode(p, checker, localScope),
  );
  const body = (() => {
    if (!node.body) {
      return undefined;
    }
    if (ts.isBlock(node.body)) {
      return compileBlockNode(node.body, checker, localScope, indentation);
    } else {
      indentation.increase();
      const statement = `${indentation.indentation}return ${compileNode(node.body, checker, localScope, new Indentation())};`;
      indentation.decrease();
      return [
        `${indentation.indentation}{`,
        statement,
        `${indentation.indentation}}`,
      ].join("\n");
    }
  })();
  const usedSymbols = (() => {
    const selfSymbols = new Set();
    if (ts.isVariableDeclaration(node.parent)) {
      const symbol = checker.getSymbolAtLocation(node.parent.name);
      if (symbol) selfSymbols.add(symbol);
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol) selfSymbols.add(symbol);
    }
    if (!node.body) {
      return [];
    }
    const parameterSymbols = new Set(
      node.parameters
        .map((p) => checker.getSymbolAtLocation(p.name))
        .filter((s): s is ts.Symbol => s !== undefined),
    );
    const usedSymbols = new Set<string>();
    const findSymbols = (node: ts.Node) => {
      const s = checker.getSymbolAtLocation(node);
      if (s && !parameterSymbols.has(s) && scope.has(s)) {
        const info = scope.get(s)!;
        if (selfSymbols.has(s)) {
          usedSymbols.add(`&${info.name}`);
          info.referenced = true;
        } else usedSymbols.add(info.name);
      }
      node.forEachChild(findSymbols);
    };
    findSymbols(node.body);
    return Array.from(usedSymbols);
  })();
  const useExpression = usedSymbols?.length
    ? `use (${usedSymbols.join(", ")}) `
    : "";
  const bodyConsideringAsync = (() => {
    if (!async || !body) {
      return body;
    }
    const singleIndent = new Indentation().increase().indentation;
    const usedSymbolsAndParamters = [...(usedSymbols ?? []), ...parameters];
    const useExpressionForAsync = usedSymbolsAndParamters.length
      ? `use (${usedSymbolsAndParamters.join(", ")}) `
      : "";
    return [
      `${indentation.indentation}{`,
      `${indentation.indentation}${singleIndent}return async(function() ${useExpressionForAsync}{`,
      ...body.split("\n").map((line) => `${singleIndent}${line}`),
      `${indentation.indentation}${singleIndent}});`,
      `${indentation.indentation}}`,
    ].join("\n");
  })();
  return `${prefix}function (${parameters.join(", ")}) ${useExpression}${
    bodyConsideringAsync
  }${ts.isFunctionDeclaration(node) ? ";" : ""}`;
};

const compileNewExpressionNode = (
  node: ts.NewExpression,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, ScopeSymbolInfo>,
  indentation: Indentation,
): string => {
  const internalTypeName = (() => {
    const constructorType = checker.getTypeAtLocation(node.expression);
    const constructorSignatures = checker.getSignaturesOfType(
      constructorType,
      ts.SignatureKind.Construct,
    );
    if (constructorSignatures.length === 0) {
      throw new Error(
        "No constructor signatures found for " + node.expression.getText(),
      );
    }
    for (const signature of constructorSignatures) {
      const returnType = checker.getReturnTypeOfSignature(signature);
      const result = getInternalTypeName(returnType, checker);
      if (result) return result;
    }
    return undefined;
  })();
  switch (internalTypeName) {
    case "Array":
      return (() => {
        if (!node.arguments || node.arguments.length === 0) {
          return "[]";
        }
        const args = node.arguments.map((x) => checker.getTypeAtLocation(x));
        if (args.length === 1) {
          if (isNumber(args[0]))
            return "array_fill(0, " + node.arguments[0].getText() + ", null)";
          return `[${compileNode(node.arguments[0], checker, scope, new Indentation())}]`;
        }
        if (args.every((arg) => isNumber(arg)))
          return (
            "[" + node.arguments.map((arg) => arg.getText()).join(", ") + "]"
          );
        throw new Error("Unsupported array constructor arguments");
      })();
  }
  const expression = compileNode(node.expression, checker, scope, indentation);
  const args = node.arguments
    ?.map((arg) => compileNode(arg, checker, scope, indentation))
    .join(", ");
  return `(new ${expression}(${args ?? ""}))`;
};

const compileCallExpressionNode = (
  node: ts.CallExpression,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, ScopeSymbolInfo>,
  indentation: Indentation,
): string => {
  const internalMethodSpec = ts.isPropertyAccessExpression(node.expression)
    ? getInternalTypePropertySpec(node.expression, checker)
    : undefined;
  if (internalMethodSpec) {
    let specificResult = undefined;
    switch (internalMethodSpec.internalTypeName) {
      case "String":
        specificResult = (() => {
          return undefined;
        })();
        break;
      case "Array":
        specificResult = (() => {
          return undefined;
        })();
        break;
      case "RegExp":
        specificResult = (() => {
          return undefined;
        })();
        break;
    }
    if (specificResult) return specificResult;
  }
  const expressionSymbol = checker.getSymbolAtLocation(node.expression);
  const expression =
    expressionSymbol && scope.has(expressionSymbol)
      ? scope.get(expressionSymbol)!.name
      : compileNode(node.expression, checker, scope, indentation);
  const args = node.arguments
    .map((arg) => compileNode(arg, checker, scope, indentation))
    .join(", ");
  return `${indentation.indentation}${expression}(${args})`;
};

const compileAwaitExpressionNode = (
  node: ts.AwaitExpression,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, ScopeSymbolInfo>,
  indentation: Indentation,
): string => {
  const expression = compileNodeEnsureParentheses(
    node.expression,
    checker,
    scope,
    indentation,
  );
  return `${expression}->await()`;
};

const compileBinaryExpressionNode = (
  node: ts.BinaryExpression,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, ScopeSymbolInfo>,
  indentation: Indentation,
): string => {
  const left =
    node.operatorToken.kind == ts.SyntaxKind.EqualsToken
      ? compileNode(node.left, checker, scope, indentation)
      : compileNodeEnsureParentheses(node.left, checker, scope, indentation);
  const right =
    node.operatorToken.kind == ts.SyntaxKind.EqualsToken
      ? compileNode(node.right, checker, scope, indentation)
      : compileNodeEnsureParentheses(node.right, checker, scope, indentation);
  const operator =
    node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
    (isStringLike(node.left, checker) || isStringLike(node.right, checker))
      ? "."
      : node.operatorToken.getText();
  return `${left} ${operator} ${right}`;
};

const compilePropertyAccessExpressionNode = (
  node: ts.PropertyAccessExpression,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, ScopeSymbolInfo>,
  indentation: Indentation,
): string => {
  const internalMethodSpec = getInternalTypePropertySpec(node, checker);
  if (internalMethodSpec) {
    let specificResult = undefined;
    switch (internalMethodSpec.internalTypeName) {
      case "String":
        specificResult = (() => {
          return undefined;
        })();
        break;
      case "Array":
        specificResult = (() => {
          if (internalMethodSpec.methodName === "length")
            return `count(${compileNode(node.expression, checker, scope, new Indentation())})`;
          return undefined;
        })();
        break;
      case "RegExp":
        specificResult = (() => {
          return undefined;
        })();
        break;
    }
    if (specificResult) return specificResult;
  }
  const expression = compileNode(node.expression, checker, scope, indentation);
  let name = node.name.getText();
  let operator = "->";
  if (isConstructible(node.expression, checker)) {
    operator = "::";
  } else if (isObjectLiteral(checker.getTypeAtLocation(node.expression))) {
    name = `[${prepareStringValue(name)}]`;
    operator = "";
  }
  return indentation.indentation + [expression, operator, name].join("");
};

const compilePropertyAssignmentNode = (
  node: ts.PropertyAssignment,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, ScopeSymbolInfo>,
): string => {
  const name = ts.isIdentifier(node.name)
    ? JSON.stringify(node.name.text)
    : ts.isStringLiteralLike(node.name)
      ? JSON.stringify(node.name.text)
      : compileNodeEnsureParentheses(
          node.name,
          checker,
          scope,
          new Indentation(),
        );
  const initializer = compileNodeEnsureParentheses(
    node.initializer,
    checker,
    scope,
    new Indentation(),
  );
  return `${name} => ${initializer}`;
};

const compileObjectLiteralExpressionNode = (
  node: ts.ObjectLiteralExpression,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, ScopeSymbolInfo>,
  indentation: Indentation,
): string => {
  indentation.increase();
  const properties = node.properties
    .map(
      (p) =>
        indentation.indentation + compileNode(p, checker, scope, indentation),
    )
    .join(",\n");
  indentation.decrease();
  const nodeType = checker.getTypeAtLocation(node.parent);
  const nodeObjectType =
    nodeType.flags & ts.TypeFlags.Object ? (nodeType as ts.ObjectType) : null;
  const isPhpObject =
    Boolean(nodeType.flags & ts.TypeFlags.Object) &&
    !Boolean(nodeType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) &&
    Boolean(
      (nodeObjectType?.objectFlags ?? 0) & ts.ObjectFlags.ClassOrInterface,
    );
  return `${
    isPhpObject ? "(object)" : ""
  }[\n${properties}\n${indentation.indentation}]`;
};

const compileImportDeclarationNode = (
  node: ts.ImportDeclaration,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, ScopeSymbolInfo>,
  indentation: Indentation,
): string => {
  if (!node.importClause) return "";
  const moduleSpecifier =
    ts.isStringLiteral(node.moduleSpecifier) &&
    node.moduleSpecifier.text
      .replace(/\//g, "\\")
      .split("\\")
      .map((name) => `${name[0].toUpperCase()}${name.slice(1)}`);
  if (!moduleSpecifier) {
    return "";
  }
  if (moduleSpecifier[0] === ".") {
    moduleSpecifier[0] = "Chasb";
    moduleSpecifier.splice(1, 0, "Backend");
  } else {
    moduleSpecifier.splice(1, 0, "Bootstrap");
  }

  let name = node.importClause.name?.text;
  let namedBindings: Array<{ name: string; alias?: string }> | undefined =
    undefined;

  if (node.importClause.name) {
    updateScope(node.importClause.name, checker, scope);
  }
  if (
    node.importClause.namedBindings &&
    ts.isNamedImports(node.importClause.namedBindings)
  ) {
    node.importClause.namedBindings.elements.forEach((binding) => {
      if (binding.propertyName) {
        updateScope(
          binding.propertyName,
          checker,
          scope,
          binding.propertyName.getText(),
        );
      } else {
        updateScope(binding.name, checker, scope, binding.name.text);
      }
    });
  }

  if (
    node.importClause.namedBindings &&
    ts.isNamedImports(node.importClause.namedBindings)
  ) {
    namedBindings = node.importClause.namedBindings.elements
      .map((n) => {
        if (!ts.isImportSpecifier(n)) return undefined;
        const name = n.propertyName ? n.propertyName.text : n.name.text;
        const alias = n.propertyName?.text;
        return { name, alias };
      })
      .filter((e) => e !== undefined);
  }
  let destructure: string = "";
  let namedBindingsDestructure: string = "";
  let imports: string = "";
  let namedBindingsImports: string = "";

  const buildDestructureItem = (name: string | number, alias?: string) => {
    return alias
      ? `${alias ? prepareStringValue(alias) : name} => $${prepareVariableName(alias)}`
      : `$${prepareVariableName(name as string)}`;
  };
  const buildImportItem = (name: string | number, alias?: string) => {
    return alias
      ? `${typeof name === "number" ? name : prepareStringValue(name)} => ${prepareStringValue(alias)}`
      : `${prepareStringValue(name as string)}`;
  };
  if (namedBindings) {
    const hasBindingsWithAlias = namedBindings?.some(
      (n) => n.alias !== undefined,
    );
    let nonAliasedBindingIndex = 0;
    nonAliasedBindingIndex = 0;
    namedBindingsDestructure = `[${namedBindings
      .map((n) =>
        hasBindingsWithAlias
          ? buildDestructureItem(
              n.alias ? n.alias : nonAliasedBindingIndex++,
              n.alias ?? n.name,
            )
          : buildDestructureItem(0, n.name),
      )
      .join(", ")}]`;
    nonAliasedBindingIndex = 0;
    namedBindingsImports = `[${namedBindings
      .map((n) =>
        hasBindingsWithAlias
          ? buildImportItem(
              n.alias ? n.name : nonAliasedBindingIndex++,
              n.alias ?? n.name,
            )
          : buildImportItem(n.name),
      )
      .join(", ")}]`;
  }
  if (name) {
    if (namedBindings) {
      destructure = `[${buildDestructureItem(name)}, ${namedBindingsDestructure}]`;
      imports = `[${buildImportItem(name)}, ${namedBindingsImports}]`;
    } else {
      destructure = buildDestructureItem(name);
      imports = "";
    }
  } else if (namedBindings) {
    destructure = namedBindingsDestructure;
    imports = namedBindingsImports;
  }
  if (imports !== "") imports = `, ${imports}`;
  return `${destructure} = ModuleBase::import(\\${moduleSpecifier.join("\\")}\\Module::class${imports});`;
};

const compileNode = (
  node: ts.Node,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, ScopeSymbolInfo>,
  indentation: Indentation,
): string => {
  if (ts.isExpressionStatement(node)) {
    return `${compileNode(node.expression, checker, scope, indentation)};`;
  }
  if (ts.isInterfaceDeclaration(node)) {
    return "";
  }
  if (ts.isImportDeclaration(node)) {
    return compileImportDeclarationNode(node, checker, scope, indentation);
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return compileStringLiteralNode(node);
  }
  if (ts.isTemplateExpression(node)) {
    return compileTemplateExpressionNode(node, checker, scope, indentation);
  }
  if (ts.isIdentifier(node)) {
    return compileIdentifierNode(node, checker, scope);
  }
  if (ts.isVariableDeclaration(node)) {
    return compileVariableDeclarationNode(node, checker, scope, indentation);
  }
  if (ts.isVariableDeclarationList(node)) {
    return compileVariableDeclarationListNode(
      node,
      checker,
      scope,
      indentation,
    );
  }
  if (ts.isVariableStatement(node)) {
    return compileVariableStatementNode(node, checker, scope, indentation);
  }
  if (ts.isReturnStatement(node)) {
    return compileReturnNode(node, checker, scope, indentation);
  }
  if (ts.isAwaitExpression(node)) {
    return compileAwaitExpressionNode(node, checker, scope, indentation);
  }
  if (ts.isBlock(node)) {
    indentation.increase();
    const statements = node.statements.map((n) =>
      compileNode(n, checker, scope, indentation),
    );
    indentation.decrease();
    return [
      `${indentation.indentation}{`,
      ...statements,
      `${indentation.indentation}}`,
    ].join("\n");
  }
  if (
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node)
  ) {
    return compileFunctionNode(node, checker, scope, indentation);
  }
  if (ts.isParameter(node)) {
    return compileParameterNode(node, checker, scope);
  }
  if (ts.isNewExpression(node)) {
    return compileNewExpressionNode(node, checker, scope, indentation);
  }
  if (ts.isCallExpression(node)) {
    return compileCallExpressionNode(node, checker, scope, indentation);
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return prepareStringValue(
      node.getText().substring(1, node.getText().length - 1),
    );
  }
  if (ts.isBinaryExpression(node)) {
    return compileBinaryExpressionNode(node, checker, scope, indentation);
  }
  if (ts.isPropertyAccessExpression(node)) {
    return compilePropertyAccessExpressionNode(
      node,
      checker,
      scope,
      indentation,
    );
  }
  if (ts.isPropertyAssignment(node)) {
    return compilePropertyAssignmentNode(node, checker, scope);
  }
  if (ts.isObjectLiteralExpression(node)) {
    return compileObjectLiteralExpressionNode(
      node,
      checker,
      scope,
      indentation,
    );
  }
  if (node.getChildCount() > 0) {
    return node
      .getChildren()
      .map((n) => compileNode(n, checker, scope, indentation))
      .join(" ");
  }
  return node.getText();
};

export const compileToPhp = (
  source: ts.SourceFile,
  checker: ts.TypeChecker,
) => {
  const usesAsync = checkDescendants(
    source,
    (n) => n.kind === ts.SyntaxKind.AsyncKeyword,
  );
  const scope = new Map<ts.Symbol, ScopeSymbolInfo>();
  const transpiledLines = [
    "$exports = [];",
    ...source.statements.map((n) =>
      compileNode(n, checker, scope, new Indentation()),
    ),
    "return $exports;",
  ];
  const moduleName = path.parse(source.fileName).name;
  const singleIndent = new Indentation().increase().indentation;
  const allLines = [
    "<?php\n",
    "declare(strict_types=1);\n\n",
    `namespace Chasb\\Backend\\${moduleName[0].toUpperCase()}${moduleName.slice(1)};\n`,
    "use \\Chasb\\Bootstrap\\Module as ModuleBase;",
    ...(usesAsync ? ["use function \\Amp\\async;"] : []),
    "",
    "class Module extends ModuleBase {",
    `${singleIndent}public function __construct()`,
    `${singleIndent}{`,
    ...Array.from(scope.values())
      .filter((info) => info.referenced)
      .map((info) => `${singleIndent}${singleIndent}${info.name} = null;`),
    ...transpiledLines
      .flatMap((line) => line.split("\n"))
      .map((line) => `${singleIndent}${singleIndent}${line}`),
    `${singleIndent}}`,
    "}",
    "",
  ];
  return allLines.join("\n");
};
