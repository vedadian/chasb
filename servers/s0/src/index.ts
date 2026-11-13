import chasb, { readTextFile } from "chasb/fs";

const createArray1 = () => new Array("Hello");
const createArray2 = () => new Array(1, 2, 3, 4);

async function doit() {
  doit();
  const d = 12;
  const m = await readTextFile(`somefile.txt`);
  const n = await readTextFile(`file${d}.txt`);
  const p = {
    message: m + n,
    a: [1, 2, 3],
    b: new Array(5).length,
    c: new Response().blob,
    d: createArray1().length,
    e: createArray2().length,
  };
  return () => Response.json(p);
}

export const main = async (req: Request) => {
  const d = await doit();
  return d();
};
