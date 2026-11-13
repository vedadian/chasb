<?php

use function Amp\async;
[$chasb, ["readTextFile" => $readTextFile]] = Module::import(Chasb\Bootstrap\Fs::class, ["chasb", ["readTextFile"]]);
["createArray1" => $createArray1] = Module::import(Chasb\Backend\Helper::class, ["createArray1"]);
$createArray2 = (function () {
  return [1, 2, 3, 4];
});
[ $a, $___0, $b ] = ([ 1 , 2 , 3 ]);
[ "a" => $d, "b" => $e ] = ([
  "a" => 12,
  "b" => 14
]);
[ "f" => $f, "g" => $g ] = ([
  "f" => 12,
  "g" => 14
]);

$AAA = ([
  "f" => 12,
  "g" => 14
]);
$AAA["f"] = 1;
($AAA["f"]) = 15;
$doit = /* async */ function () use ($doit, $createArray2) {
  return async(function() use ($doit, $createArray2) {
  {
    $doit() ;
    $d = 12;
    $m = ((readTextFile("somefile.txt"))->await());
    $n = ((readTextFile("file" . ($d) . ".txt"))->await());
    $p = ([
      "message" => ($m . $n),
      "a" => ([ 1 , 2 , 3 ]),
      "b" => (count(array_fill(0, 5, null))),
      "c" => ((new Response())["blob"]),
      "d" => (count(createArray1())),
      "e" => (count($createArray2()))
    ]);
    return function () use ($p)   {
      return Response::json($p);
    };
  }
  });
}
/* export */ $main = (/* async */ function ($req) use ($doit) {
  return async(function() use ($doit, $req) {
  {
    $d = (($doit())->await());
    return $d();
  }
  });
});
