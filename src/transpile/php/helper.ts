import ts from "typescript";

export class Indentation {
  private level: number = 0;
  public increase() {
    this.level++;
    return this;
  }
  public decrease() {
    if (this.level > 0) this.level--;
    return this;
  }
  public get indentation() {
    return "  ".repeat(this.level);
  }
}

export const prepareVariableName = (name: string | undefined) =>
  name && name.replace(/\$/g, "_");

export const prepareStringValue = (value: string) =>
  JSON.stringify(value.replace(/\$/g, "\\$"));

export const isStringLike = (node: ts.Node, checker: ts.TypeChecker) =>
  Boolean(checker.getTypeAtLocation(node).flags & ts.TypeFlags.StringLike);

export const isConstructible = (node: ts.Node, checker: ts.TypeChecker) =>
  Boolean(checker.getTypeAtLocation(node)?.getConstructSignatures().length > 0);

export const isNumber = (type: ts.Type): boolean =>
  (type.flags & ts.TypeFlags.NumberLike) !== 0;

export const isString = (type: ts.Type): boolean =>
  (type.flags & ts.TypeFlags.StringLike) !== 0;

export const isArray = (checker: ts.TypeChecker, type: ts.Type): boolean =>
  checker.isArrayType(type) || checker.isTupleType(type);

export const isRegExp = (type: ts.Type): boolean => {
  if (!(type.flags & ts.TypeFlags.Object)) return false;

  return type.getSymbol()?.getName() === "RegExp";
};

export const getInternalTypeName = (type: ts.Type, checker: ts.TypeChecker) => {
  if (isString(type)) return "String" as const;
  if (isArray(checker, type)) return "Array" as const;
  if (isRegExp(type)) return "RegExp" as const;

  return undefined;
};

export const getInternalTypePropertySpec = (
  node: ts.PropertyAccessExpression,
  checker: ts.TypeChecker,
) => {
  const { expression, name } = node;
  const type = checker.getTypeAtLocation(expression);
  const internalTypeName = getInternalTypeName(type, checker);

  if (!internalTypeName) return undefined;

  return {
    internalTypeName,
    methodName: name.text,
  };
};
