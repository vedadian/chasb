import path from "node:path";
import fs from "node:fs/promises";
import cac from "cac";

import { compileToPhp } from "./php/compile.js";
import { getTypescriptProgram } from "./project.js";
import { validateTypescriptProgram } from "./validate.js";

const scriptDir = path.dirname(new URL(import.meta.url).pathname);

const cli = cac();

const prepareName = (fileName: string) =>
  `${fileName[0].toUpperCase()}${fileName.slice(1)}`;

cli
  .command("php <projectPath>", "Transpile a typescript program")
  .action(async (projectPath: string) => {
    console.log(`Validating ${projectPath}...`);
    const outputPath = path.join(path.dirname(projectPath), "dist");
    // If output path does not exist, create it
    try {
      await fs.access(outputPath);
    } catch {
      await fs.mkdir(outputPath, { recursive: true });
    }
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
      // Write composer json content
      // composer require amphp/amp
      const composerJsonPath = path.join(outputPath, "composer.json");
      const composerJsonContent = {
        autoload: {
          "psr-4": {
            "Chasb\\": "src/",
          },
        },
        require: {
          "amphp/amp": ">=3.1",
        },
      };
      await fs.writeFile(
        composerJsonPath,
        JSON.stringify(composerJsonContent, null, 2),
      );
      const bootstrapPath = path.join(outputPath, "src", "Bootstrap");
      await fs.mkdir(bootstrapPath, { recursive: true });
      // Copy Bootstrap files to the output directory
      const bootstrapSourcePath = path.join(scriptDir, "php", "Bootstrap");
      const bootstrapFiles = await fs.readdir(bootstrapSourcePath);
      for (const file of bootstrapFiles) {
        const sourceFilePath = path.join(bootstrapSourcePath, file);
        const destFilePath = path.join(bootstrapPath, file);
        await fs.copyFile(sourceFilePath, destFilePath);
      }
      for (const sourceFile of program.getSourceFiles()) {
        if (sourceFile.isDeclarationFile) {
          continue;
        }
        const outputFilePath = path.join(
          outputPath,
          "src",
          "Backend",
          prepareName(path.parse(sourceFile.fileName).name),
          "Module.php",
        );
        console.log(`Transpiling ${sourceFile.fileName} to ${outputFilePath}`);
        const phpCode = compileToPhp(sourceFile, program.getTypeChecker());
        await fs.mkdir(path.dirname(outputFilePath), { recursive: true });
        await fs.writeFile(outputFilePath, phpCode);
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
