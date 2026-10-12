{
  outputs =
    { nixpkgs, ... }:
    let
      eachSystem =
        f:
        nixpkgs.lib.genAttrs nixpkgs.lib.systems.flakeExposed (
          system: f system nixpkgs.legacyPackages.${system}
        );
    in
    {
      devShells = eachSystem (
        _system: pkgs: {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs
              pkgs.corepack
              pkgs.typescript
              pkgs.duckdb
            ];
          };
        }
      );
    };
}
