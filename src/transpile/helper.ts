import ts from "typescript";

export type ProjectDiagnostic = {
  filePath: string;
  line: number;
  column: number;
  message: string;
};

export const isAny = (type: ts.Type): boolean => {
  return (type.flags & ts.TypeFlags.Any) !== 0;
};

export const isUnknown = (type: ts.Type): boolean => {
  return (type.flags & ts.TypeFlags.Unknown) !== 0;
};
