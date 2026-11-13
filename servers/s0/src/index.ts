import chasb, { readTextFile } from "chasb/fs";
import { createArray1 } from "./helper";

const createArray2 = () => new Array(1, 2, 3, 4);
const [a, , b] = [1, 2, 3];
const { a: d, b: e } = { a: 12, b: 14 };
const { f, g } = { f: 12, g: 14 };

interface AAAI {
  f: number;
  g: number;
}

let AAA: AAAI = { f: 12, g: 14 };
AAA.f = 15;

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
