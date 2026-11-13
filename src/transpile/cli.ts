import path from "node:path";
import cac from "cac";

import { compileToPhp } from "./php/compile.js";
import { getTypescriptProgram } from "./project.js";
import { validateTypescriptProgram } from "./validate.js";

const cli = cac();

const prepareName = (fileName: string) =>
  `${fileName[0].toUpperCase()}${fileName.slice(1)}`;

cli
  .command("php <projectPath>", "Transpile a typescript program")
  .action((projectPath: string) => {
    console.log(`Validating ${projectPath}...`);
    const { program, diagnostics } = getTypescriptProgram(projectPath);
    const validationDiagnostics = program
      ? validateTypescriptProgram(program)
      : [];
    const allDiagnostics = [...diagnostics, ...validationDiagnostics];
    if (allDiagnostics.length > 0) {
      console.error("Validation failed with the following diagnostics:");
      for (const diagnostic of allDiagnostics) {
        console.error(
          `${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column} - ${diagnostic.message}`,
        );
      }
      process.exit(1);
    }
    if (program) {
      console.log("\n\n");
      for (const sourceFile of program.getSourceFiles()) {
        if (sourceFile.isDeclarationFile) {
          continue;
        }
        console.log(
          `================ src/Backend/${prepareName(path.parse(sourceFile.fileName).name)}/Module.php ================`,
        );
        const phpCode = compileToPhp(sourceFile, program.getTypeChecker());
        console.log(phpCode);
      }
    }
  });

cli.addEventListener("command:*", () => {
  console.error(`Unknown command: ${cli.args[0]}`);
  cli.outputHelp();
  process.exit(1);
});

cli.help();
cli.parse();
