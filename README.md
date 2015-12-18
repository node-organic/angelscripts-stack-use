# angel-stack-use v0.0.2

Manage current working project's stack

## usage

1. install script to existing project

    $ npm install angelscripts-stack --save-dev

3. execute the script via `organic-angel`

    $ angel stack use {remote} {updatePath} {branch}

### options

* `updatePath` - relative path to either `remote` or current working directory
* `remote` - optional, git repo url
* `branch` - optional, used with git `remote` to specify remote's source code branch
