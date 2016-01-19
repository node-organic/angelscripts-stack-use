# angel-stack-use v0.1.3

Manage current working project's stack

## usage

___install___

```
$ npm install angelscripts-stack-use
```

### $ angel stack use

Applies stack upgrade within `cwd`.

```
$ angel stack use {remote} {updatePath} {branch}
```

___arguments___

* `remote` - *optional*, git repo url or name of stack upgrade
* `updatePath` - relative path to either `remote` or current working directory
* `branch` - *optional*, used with git `remote` to specify remote's source code branch

#### logic behind

1. read `upgrade.json`(`upgrade`) from stack upgrade root folder (`stackRootFolder`)
  - `upgrade.main` - pointer to relative directory containing the upgrade files, default `''`
  - `upgrade.name` - name of the upgrade
  - `upgrade.version` - version of the upgrade
  - `upgrade.dependencies` - key value pairs of `name: version`
  - `upgrade.peerUpgrades` - key value pairs of `name: relativePath`
2. `upgrade.depencencies` should be present as key in `stack-upgrades` within `package.json`
3. ___apply stack upgrade___ - copy recursively all files from `stackRootFolder + upgrade.main` where:
  - `.json` files are deep merged
  - `.gitignore` files are rewritten only with the unique lines
  - any other file is overriden
4. ___apply stack upgrade peers___ - use the same method as within step 3) for every `upgrade.peerUpgrades` match towards `stack-upgrades` hash from `package.json`
5. store within `package.json`'s `stack-upgrades` hash the applied upgrade `{name: version}`

### $ angel stack list

List available stack upgrades within `cwd`.

```
$ angel stack list
```

### $ angel stack configure

Prompt once for unique `{{{placeholders}}}` within files at `cwd` and replace them with provided values.

```
$ angel stack configure
```

## how to create stack upgrade

1. create a standard `npm package` as `my-stack-upgrade`
2. place `upgrade.json` there
3. have fun && `$ mkdir ../my-upgraded-app && cd ../my-upgraded-app && angel stack use ../my-stack-upgrade`
