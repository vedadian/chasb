<?php

namespace Chasb\Bootstrap;

class Module {
  private static array $cache = [];

  /**
   * Imports the specified exports from the given module class.
   * If no imports are specified, returns the default export or all exports.
   * @param string $class The fully qualified class name of the module.
   * @param array{string,array<string|int, string>}|array<string|int, string>|null $imports The list of imports to retrieve.
   * @return mixed The imported exports or the default export.
   */
  public static function import(string $class, ?array $imports = null) {
    if(!class_exists($class)) {
        throw new \RuntimeException("Module class not found: $class");
    }
    if (!is_subclass_of($class, self::class)) {
        throw new \RuntimeException("Invalid module class: $class");
    }
    if (!isset(self::$cache[$class])) {
        $reflection = new \ReflectionClass($class);
        if (!$reflection->isInstantiable()) {
            throw new \RuntimeException(
                "Module class is not instantiable: $class"
            );
        }
        self::$cache[$class] = new $class();
    }
    return self::$cache[$class]->pick($imports);
  }

  private array $exports = [];

  /**
   * Picks the specified imports from the module's exports.
   * If the imports array has a specific structure, it recursively picks nested imports.
   * @param array{string,array<string|int, string>}|array<string|int, string>|null $imports The list of imports to retrieve.
   * @return array The picked exports.
   */
  private function pick(?array $imports = null): array {
    if ($imports === null) {
      return array_key_exists('default', $this->exports)
          ? $this->exports['default']
          : $this->exports;
    }
    if (
      count($imports) === 2 &&
      is_string($imports[0]) &&
      is_array($imports[1])
    ) {
      return [
        $this->pick(null),
        $this->pick($imports[1])
      ];
    }
    $result = [];
    foreach ($imports as $key => $alias) {
        $name = is_int($key) ? $alias : $key;
        if (!array_key_exists($name, $this->exports)) {
            throw new \RuntimeException("Module export not found: $name");
        }
        $result[$alias] = $this->exports[$name];
    }
    return $result;
  }

  /**
   * Exports a module by invoking the provided factory function.
   * The factory function must be named 'module'.
   * Caches the result based on the function's namespace.
   * @param Closure(): array<string, mixed> $factory The factory function that returns the module exports.
   */
  public function __construct(\Closure $factory) {
    $function = new \ReflectionFunction($factory);
    $this->exports = $factory();
  }

}