const fs = require('fs');
const pathLib = require('path');
const dirTree = require('directory-tree');
const os = require('os'),

    assertDirectoryExistence = (dir) => {
        try {
            fs.readdirSync(dir);
        }
        catch (e) {
            console.error(`Unable to open directory ${dir} for implode:\n${e}\n`);
            process.exit(-1);
        }
    },

    assertDirectoryAbsence = (dir) => {
        try {
            fs.readdirSync(dir);
            console.error(`Directory ${dir} already exists, exiting`);
            process.exit(-1);
        }
        catch (e) {
            // do nothing, directory is absent

        }
    },

    assertFileExistence = (file) => {
        try {
            fs.accessSync(file, fs.constants.R_OK);
        }
        catch (e) {
            console.error(`Unable to open file ${file}\n`);
            process.exit(-1);
        }
    },

    assertCollectionDir = (dir) => {
        try {
            assertDirectoryExistence(dir);
        }
        catch (e) {
            console.error(`Unable to open directory ${dir} for creating test:\n${e}\n`);
            process.exit(-1);
        }
        try {
            assertFileExistence(`${dir}/.meta.json`);
        }
        catch (e) {
            console.error(`${dir} is not a collection dir.  .meta.json file not-readable :\n${e}\n`);
            process.exit(-1);
        }
    },

    // create directory
    createDir = (dir) => {
        if (fs.existsSync(dir)) {
            throw new
            Error(`directory ${dir} already exists, use unique names for your requests files within a directory`);
        }
        else {
            fs.mkdirSync(dir, { recursive: true });
        }
    },

    // create file
    createFile = (fileName, content, opts) => {
    // fs.writeFileSync(fileName, content + '\n');
        fs.writeFileSync(fileName, content + ((typeof (opts) === 'object' && opts.skipTrailingNewLine) ? '' : '\n'));
    },

    // remove forward slashes in name
    sanitizePathName = (name) => {
        return name.replace(/\//g, '_slash_');
    },

    // break down event attribute into individual JS code files
    createEventFiles = (itemDir, event) => {
        let eventOrder = [],
            eventMeta;

        event.forEach((element) => {
            let eventFileName = `event.${element.listen}.js`,
                eventFilePath = `${itemDir}/${eventFileName}`;

            eventOrder.push(eventFileName);
            createFile(eventFilePath, element.script.exec.join('\n'), { skipTrailingNewLine: true });
        });

        eventMeta = {
            eventOrder
        };

        createFile(`${itemDir}/.event.meta.json`, JSON.stringify(eventMeta, null, 2));
    },

    checkAndCreateEventEntry = (name, path) => {
        const eventMatches = name.match(/^event\.([^.]+)\.js$/);
        let result = {},
            fileContent;

        if (eventMatches) {
            fileContent = fs.readFileSync(path).toString();
            result = {
                listen: eventMatches[1],
                script: {
                    exec: fileContent.split('\n'),
                    type: 'text/javascript'
                }
            };
        }

        return result;
    },

    topLevelFileKeys = {
        variable: 1,
        info: 1,
        auth: 1
    },

    traverse = (thing, ancestors, options) => {
        let parent = './' + ancestors.join('/'),
            elementOrder = [],
            elementMap = {},
            itemDir,
            meta,
            name = '',
            newParent;

        if (ancestors.length === 0) {
            // this is top level set directory name from info
            name = thing.info.name;
        }
        else {
            // set directory name to thing['name']
            name = thing.name;
        }

        if (name.includes('/') && !options.substituteSlashes) {
            throw new
            Error(`collection with names containing slash ${name} cannot be processed - consider renaming them`,
                'slash');
        }

        name = sanitizePathName(name);

        itemDir = `${parent}/${name}`;

        if (thing.item) {
            // TODO - handle directory creation error
            createDir(itemDir);

            // top-level files to be created after top-level directory is created
            if (ancestors.length === 0) {
                Object.keys(topLevelFileKeys).forEach((element) => {
                    if (thing[element]) {
                        let obj = {};

                        obj[element] = thing[element];
                        // TODO - handle file creation error
                        createFile(`${parent}/${name}/.${element}.json`, JSON.stringify(obj, null, 2));
                    }
                });

                // create top level event javascript files
                if (thing.event) {
                    createEventFiles(itemDir, thing.event);
                }
            }

            // walk-through items
            newParent = ancestors.map((x) => { return x; });
            newParent.push(name);


            thing.item.forEach((element) => {
                // dis-ambiguate duplicate folder names
                if (elementMap[element.name]) {
                    element.name += '-copy';
                }
                elementMap[element.name] = true;

                elementOrder.push(sanitizePathName(element.name));
                traverse(element, newParent, options);
            });

            meta = {
                childrenOrder: elementOrder
            };

            if (thing.description) {
                meta.description = thing.description;
            }

            // TODO save order of folders as meta
            createFile(`${parent}/${name}/.meta.json`, JSON.stringify(meta, null, 2));
        }

        if (thing.request) {
            /*
              - save request under ancestors dir
              - save tests that is part of event
            */
            createDir(itemDir);
            let requestFileName = `${itemDir}/request.json`,
                contentTypeJsonHeaderIndex = thing.request.header ? thing.request.header.findIndex((element) => {
                    return (element.key === 'Content-Type' && element.value === 'application/json');
                }) : -1,
                isBodyLangJson = (thing.request.body && thing.request.body.options &&
                    thing.request.body.options.raw && thing.request.body.options.raw.language === 'json');

            // we have a body in the request
            if ((contentTypeJsonHeaderIndex > -1 || isBodyLangJson) && (thing.request.body && thing.request.body.raw)) {
                // add raw post body as formatted JSON, will be removed in the import
                try {
                    thing.request.body.raw_json_formatted = JSON.parse(thing.request.body.raw);
                    delete thing.request.body.raw;
                }
                catch (e) {
                    console.warn(`Unable to parse raw body for ${name}`);
                }
            }

            createFile(requestFileName, JSON.stringify(thing.request, null, 2));

            if (thing.event) {
                createEventFiles(itemDir, thing.event);
            }

            if (thing.response) {
                let responseFileName = `${itemDir}/response.json`;

                createFile(responseFileName, JSON.stringify(thing.response, null, 2));
            }
        }
    },

    walkDirTree = (dirTreeJson, level) => {
    // console.log(JSON.stringify(dirTreeJson, null, 2));
        const { path, name, children, type } = dirTreeJson;
        let items,
            others,
            result = {};

        // console.log(`@@@@ Walking directory ${name}:${level}:${type}`);

        if (level === 1) {
            // collect following top level keys
            // info
            // auth
            // event
            // variable
            let matches = name.match(/\.([^./]*)\.json$/);

            if (matches && topLevelFileKeys[matches[1]]) {
                let item = matches[1];

                result[item] = JSON.parse(fs.readFileSync(path))[item];

                return result;
            }
        }
        // console.log(`processing name:${name} with type:${type} in path:${path}`);

        switch (type) {
            case 'file':
                // console.log(`@@@@ Leaf node ${name}:${level}:${type}`);
                switch (name) {
                    case '.meta.json':
                        break;
                    case 'request.json':
                        result = {
                            request: JSON.parse(fs.readFileSync(path))
                        };
                        if (result.request.body && result.request.body.raw_json_formatted) {
                            result.request.body.raw = JSON.stringify(result.request.body.raw_json_formatted);
                            delete result.request.body.raw_json_formatted;
                        }
                        break;
                    case 'response.json':
                        result = {
                            response: JSON.parse(fs.readFileSync(path))
                        };
                        break;
                    default:
                        result = checkAndCreateEventEntry(name, path);
                        break;
                }
                break;
            case 'directory':
                items = [];
                others = {};

                // console.log(`@@@@ Getting into directory ${name}:${level}:${type}`);
                // top level name is part of info key
                if (level !== 0) {
                    result.name = name;
                }
                if (children instanceof Array && children.length > 0) {
                    let metaFilePath = pathLib.join(path, '.meta.json');

                    try {
                        fs.accessSync(metaFilePath, fs.constants.R_OK);
                        let meta = JSON.parse(fs.readFileSync(metaFilePath)),
                            childrenOrder = meta.childrenOrder;

                        // console.log(`childrenOrder: ${JSON.stringify(childrenOrder)}`);
                        // console.log(`children filtered: ${JSON.stringify(children)}`);
                        children.sort((a, b) => {
                            // console.log(`a.name: :${a.name}: b.name: :${b.name}:`);
                            let aIndex = childrenOrder.findIndex((e) => { return (e === a.name); }),
                                bIndex = childrenOrder.findIndex((e) => { return (e === b.name); });

                            // console.log(`aIndex: ${aIndex} bIndex: ${bIndex}`);
                            return (aIndex < bIndex) ? -1 : 1;
                        });
                        // console.log(`childrenOrder after sort: ${JSON.stringify(children)}`);
                        // add description from meta
                        if (meta.description) {
                            result.description = meta.description;
                        }
                    }
                    catch (e) {
                    // ignore if .meta.json does not exist
                    }
                    children.forEach((child) => {
                        let output = walkDirTree(child, level + 1);

                        if (child.type === 'file') {
                            if (child.name.match(/event/)) {
                                if (!result.event) {
                                    result.event = [];
                                }
                                result.event.push(output);
                            }
                            else {
                                Object.assign(others, output);
                            }
                        }
                        else {
                            items.push(output);
                        }
                    });
                    // sort event entries using event meta
                    if (result.event) {
                        let eventMetaFilePath = pathLib.join(path, '.event.meta.json'),
                            eventOrder,
                            eventMeta;

                        fs.accessSync(eventMetaFilePath, fs.constants.R_OK);
                        eventMeta = JSON.parse(fs.readFileSync(eventMetaFilePath));
                        eventOrder = eventMeta.eventOrder;

                        result.event.sort((a, b) => {
                            // console.log(`a.name: :${a.name}: b.name: :${b.name}:`);
                            let aIndex = eventOrder.findIndex((e) => { return (e === `event.${a.listen}.js`); }),
                                bIndex = eventOrder.findIndex((e) => { return (e === `event.${b.listen}.js`); });

                            // console.log(`aIndex: ${aIndex} bIndex: ${bIndex}`);
                            return (aIndex < bIndex) ? -1 : 1;
                        });
                    }

                    if (items.length > 0) {
                        result.item = items;
                    }
                }
                Object.assign(result, others);
                break;
            default:
                break;
        }

        return result;
    },

    dirTreeToCollectionJson = function (collectionDir) {
        const tree = dirTree(collectionDir,
                { attributes: ['type'], exclude: /\.meta\.json/ }),
            collectionJson = walkDirTree(tree, 0);

        return collectionJson;
    },

    createPostmanFolder = function (folderPath) {
        const parentDir = pathLib.dirname(folderPath),
            trimmedFolderPath = folderPath.replace(/\/+$/, ''),
            folderPathBaseName = pathLib.basename(folderPath),
            parentMetaFilePath = pathLib.join(parentDir, '.meta.json'),
            metaFilePath = pathLib.join(folderPath, '.meta.json');

        // clean-up if directory already exists
        fs.rmSync(`${folderPath}`, { recursive: true, force: true });

        // check if folderPath's parent is already a collection folder
        assertCollectionDir(parentDir);

        try {
            createDir(trimmedFolderPath);
        }
        catch (e) {
            console.error(`Could not create folder at ${folderPath}`);
            process.exit(-1);
        }

        // add new folder to parent's .meta.json
        try {
            fs.accessSync(parentMetaFilePath, fs.constants.R_OK);
            let meta = JSON.parse(fs.readFileSync(parentMetaFilePath)),
                childrenOrder = meta.childrenOrder;

            if (!childrenOrder.includes(folderPathBaseName)) {
                childrenOrder.push(folderPathBaseName);
            }

            meta = {
                childrenOrder
            };

            createFile(parentMetaFilePath, JSON.stringify(meta, null, 2));
        }
        catch (e) {
            console.error(`Could not update ${parentMetaFilePath} with new request ${folderPath}: ${e}`);
            fs.rmSync(`${folderPath}`, { recursive: true, force: true });
            process.exit(-1);
        }

        // add .meta.json to new folder
        try {
            let meta = {
                childrenOrder: []
            };

            createFile(metaFilePath, JSON.stringify(meta, null, 2));
        }
        catch (e) {
            console.error(`Could not create ${metaFilePath} under new folder ${folderPath}: ${e}`);
            fs.rmSync(`${folderPath}`, { recursive: true, force: true });
            process.exit(-1);
        }
    },

    removePostmanFolder = function (folderPath) {
        const parentDir = pathLib.dirname(folderPath),
            folderPathBaseName = pathLib.basename(folderPath),
            metaFilePath = pathLib.join(parentDir, '.meta.json');

        // check if folderPath's parent is already a collection folder
        assertCollectionDir(parentDir);

        // remove directory
        try {
            fs.rmSync(folderPath, { recursive: true, force: true });
        }
        catch (e) {
            console.error(`Could not delete folder at ${folderPath}, please check permissions`);
            process.exit(-1);
        }

        // remove folder from parent's .meta.json
        try {
            fs.accessSync(metaFilePath, fs.constants.R_OK);
            let meta = JSON.parse(fs.readFileSync(metaFilePath)),
                childrenOrder = meta.childrenOrder;

            childrenOrder = childrenOrder.filter((item) => { return item !== folderPathBaseName; });

            meta = {
                childrenOrder
            };

            createFile(metaFilePath, JSON.stringify(meta, null, 2));
        }
        catch (e) {
            console.error(`Could not update ${metaFilePath} with ${folderPath} removed: ${e}`);
            fs.rmSync(folderPath, { recursive: true, force: true });
            process.exit(-1);
        }
    },

    createTempDir = function () {
        return fs.mkdtempSync(pathLib.join(os.tmpdir(), 'newman-'));
    };

module.exports = {
    assertCollectionDir,
    assertDirectoryAbsence,
    assertDirectoryExistence,
    assertFileExistence,
    createFile,
    createDir,
    createPostmanFolder,
    createTempDir,
    dirTreeToCollectionJson,
    removePostmanFolder,
    sanitizePathName,
    traverse,
    walkDirTree
};
