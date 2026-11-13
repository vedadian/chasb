import ts from "typescript";
import {
  getInternalTypeName,
  getInternalTypePropertySpec,
  Indentation,
  isConstructible,
  isNumber,
  isStringLike,
  prepareStringValue,
  prepareVariableName,
} from "./helper.js";

const compileNodeEnsureParentheses = (
  node: ts.Node,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, string>,
  indentation: Indentation,
): string => {
  const code = compileNode(node, checker, scope, indentation);
  return ts.isIdentifier(node) || ts.isParenthesizedExpression(node)
    ? code
    : `(${code})`;
};

const compileIdentifierNode = (
  node: ts.Identifier,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, string>,
): string => {
  const symbol = checker.getSymbolAtLocation(node);
  const variableName = symbol && scope.get(symbol);
  return variableName ? `${variableName}` : node.text;
};

const compileStringLiteralNode = (
  node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral,
): string => prepareStringValue(node.text);

const compileTemplateExpressionNode = (
  node: ts.TemplateExpression,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, string>,
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
  scope: Map<ts.Symbol, string>,
  indentation: Indentation,
): string => {
  const symbol = checker.getSymbolAtLocation(node.name);
  const name =
    (isConstructible(node.name, checker) ? "" : "$") +
    prepareVariableName(node.name.getText());
  const initializer =
    node.initializer &&
    compileNode(node.initializer, checker, scope, indentation);
  if (symbol && name) {
    scope.set(symbol, name);
  }
  if (!initializer || !name) return "";
  return `${name} = (${initializer})`;
};

const compileParameterNode = (
  node: ts.ParameterDeclaration,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, string>,
): string => {
  const symbol = checker.getSymbolAtLocation(node.name);
  if (!ts.isIdentifier(node.name)) {
    throw new Error("Parameter name must be an identifier.");
  }
  const name = prepareVariableName(node.name.getText());
  const phpName = name && `$${name}`;
  if (symbol && phpName) {
    scope.set(symbol, phpName);
  }
  return name ? `${phpName}` : "";
};

const compileVariableDeclarationListNode = (
  node: ts.VariableDeclarationList,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, string>,
  indentation: Indentation,
): string => {
  return node.declarations
    .map((decl) =>
      compileVariableDeclarationNode(decl, checker, scope, indentation),
    )
    .map((line) => `${indentation.indentation}${line};`)
    .join("\n");
};

const compileVariableStatementNode = (
  node: ts.VariableStatement,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, string>,
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
  );
  if (isExported) {
    return `/* export */ ${declarationList}`;
  }
  return declarationList;
};

const compileBlockNode = (
  node: ts.Block,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, string>,
  indentation: Indentation,
): string => {
  const localScope = new Map(scope);
  indentation.increase();
  const statements = node.statements.map((n) =>
    compileNode(n, checker, localScope, indentation),
  );
  indentation.decrease();
  return [
    `${indentation.indentation}{`,
    ...statements,
    `${indentation.indentation}}`,
  ].join("\n");
};

const compileReturnNode = (
  node: ts.ReturnStatement,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, string>,
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
  scope: Map<ts.Symbol, string>,
  indentation: Indentation,
): string => {
  const localScope = new Map(scope);
  const name = prepareVariableName(node.name?.getText());
  const async = node.modifiers?.some(
    (m) => m.kind === ts.SyntaxKind.AsyncKeyword,
  );
  let prefix = "";
  if (name !== undefined) {
    const symbol = checker.getSymbolAtLocation(node.name!);
    const phpName = `$${name}`;
    if (symbol) {
      console.log({ name, phpName });
      scope.set(symbol, phpName);
    }
    if (node.kind === ts.SyntaxKind.FunctionDeclaration && name) {
      prefix = `${phpName} = `;
    }
  }
  const generator = node.asteriskToken !== undefined;
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
    if (!node.body) {
      return [];
    }
    const parameterSymbols = new Set(
      node.parameters
        .map((p) => checker.getSymbolAtLocation(p.name))
        .filter((s): s is ts.Symbol => s !== undefined),
    );
    const usedSymbols: string[] = [];
    const findSymbols = (node: ts.Node) => {
      const s = checker.getSymbolAtLocation(node);
      if (s && !parameterSymbols.has(s) && scope.has(s)) {
        usedSymbols.push(scope.get(s)!);
      }
      node.forEachChild(findSymbols);
    };
    findSymbols(node.body);
    return usedSymbols;
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
  return `${prefix}${
    async ? (generator ? "/* async* */ " : "/* async */ ") : ""
  }${generator ? "*" : ""}function (${parameters.join(", ")}) ${useExpression}${
    bodyConsideringAsync
  }`;
};

const compileNewExpressionNode = (
  node: ts.NewExpression,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, string>,
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
  return `new ${expression}(${args ?? ""})`;
};

const compileCallExpressionNode = (
  node: ts.CallExpression,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, string>,
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
  console.log({ expression: node.expression.getText() });
  const expressionSymbol = checker.getSymbolAtLocation(node.expression);
  const expression =
    expressionSymbol && scope.has(expressionSymbol)
      ? scope.get(expressionSymbol)
      : compileNode(node.expression, checker, scope, indentation);
  const args = node.arguments
    .map((arg) => compileNode(arg, checker, scope, indentation))
    .join(", ");
  return `${expression}(${args})`;
};

const compileAwaitExpressionNode = (
  node: ts.AwaitExpression,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, string>,
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
  scope: Map<ts.Symbol, string>,
  indentation: Indentation,
): string => {
  const left = compileNodeEnsureParentheses(
    node.left,
    checker,
    scope,
    indentation,
  );
  const right = compileNodeEnsureParentheses(
    node.right,
    checker,
    scope,
    indentation,
  );
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
  scope: Map<ts.Symbol, string>,
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
  const expression = compileNodeEnsureParentheses(
    node.expression,
    checker,
    scope,
    indentation,
  );
  const name = node.name.getText();
  return (
    indentation.indentation +
    [
      expression,
      isConstructible(node.expression, checker) ? "::" : "->",
      name,
    ].join("")
  );
};

const compilePropertyAssignmentNode = (
  node: ts.PropertyAssignment,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, string>,
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
  scope: Map<ts.Symbol, string>,
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
  return `[\n${properties}\n${indentation.indentation}]`;
};

const compileImportDeclarationNode = (
  node: ts.ImportDeclaration,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, string>,
  indentation: Indentation,
): string => {
  const moduleSpecifier =
    ts.isStringLiteral(node.moduleSpecifier) &&
    node.moduleSpecifier.text.replace(/\//g, "\\");
  if (!moduleSpecifier) {
    return "";
  }
  if (moduleSpecifier.startsWith(".")) {
    return "";
  }
  if (node.importClause) {
    const importLines = [];
    if (
      node.importClause.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      const imports = node.importClause.namedBindings.elements.map((n) => {
        if (!ts.isImportSpecifier(n)) return undefined;
        const propertyName = n.propertyName ? n.propertyName.text : n.name.text;
        const alias = n.propertyName ? ` as ${n.name.text}` : "";
        const nodeType = checker.getTypeAtLocation(n);
        if (nodeType.getCallSignatures().length > 0) {
          return `${indentation.indentation}use function ${moduleSpecifier}\\${propertyName}${alias};`;
        }
      });
      importLines.push(...imports.filter((i) => i !== undefined));
    }
    if (node.importClause.name) {
      importLines.push(
        `${indentation.indentation}use ${moduleSpecifier} as ${node.importClause.name.text};`,
      );
    }
    if (importLines.length > 0) {
      return importLines.join("\n");
    }
  }
  return `${indentation.indentation}use ${moduleSpecifier};`;
};

const compileNode = (
  node: ts.Node,
  checker: ts.TypeChecker,
  scope: Map<ts.Symbol, string>,
  indentation: Indentation,
): string => {
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
  const scope = new Map<ts.Symbol, string>();
  const parts = [
    "use function Amp\\async;",
    ...source.statements.map((n) =>
      compileNode(n, checker, scope, new Indentation()),
    ),
  ];
  return parts.join("\n");
};
