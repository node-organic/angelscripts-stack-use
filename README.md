# angel-stack-use v0.1.1

Manage current working project's stack

## usage

1. install script to existing project

  ```
  $ npm install angelscripts-stack-use --save-dev
  ```

2. execute the script via `organic-angel`

  ```
  $ angel stack use {remote} {updatePath} {branch}
  ```

___arguments___

* `remote` - *optional*, git repo url or name of stack upgrade
* `updatePath` - relative path to either `remote` or current working directory
* `branch` - *optional*, used with git `remote` to specify remote's source code branch
