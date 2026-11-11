import cac from "cac";

import { compileToPhp } from "./php/compile.js";
import { getTypescriptProgram } from "./project.js";
import { validateTypescriptProgram } from "./validate.js";

const cli = cac();

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
      const phpCode = compileToPhp(
        program.getSourceFile(program.getRootFileNames()[0])!,
        program.getTypeChecker(),
      );
      console.log(phpCode);
    }
  });

cli.addEventListener("command:*", () => {
  console.error(`Unknown command: ${cli.args[0]}`);
  cli.outputHelp();
  process.exit(1);
});

cli.help();
cli.parse();
