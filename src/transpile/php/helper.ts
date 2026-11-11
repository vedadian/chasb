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

export const prepareStringValue = (value: string) => JSON.stringify(value);

export const isStringLike = (node: ts.Node, checker: ts.TypeChecker) =>
  Boolean(checker.getTypeAtLocation(node).flags & ts.TypeFlags.StringLike);

export const isConstructible = (node: ts.Node, checker: ts.TypeChecker) =>
  Boolean(checker.getTypeAtLocation(node)?.getConstructSignatures().length > 0);
