import { readTextFile } from "chasb/fs";

async function doit() {
  const d = 12;
  const m = await readTextFile(`somefile.txt`);
  const n = await readTextFile(`file${d}.txt`);
  const p = { message: m + n, a: [1, 2, 3], b: new Response().blob };
  return () => Response.json(p);
}

export const main = async (req: Request) => {
  const d = await doit();
  return d();
};
