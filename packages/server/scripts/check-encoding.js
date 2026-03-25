const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../../');
const decoder = new TextDecoder('utf-8', { fatal: true });

const EXCLUDE_DIRS = new Set([
    '.git',
    '.qilin-claw',
    '.wwebjs_cache',
    'build',
    'coverage',
    'dist',
    'node_modules',
]);

const INCLUDE_EXTENSIONS = new Set([
    '.bat',
    '.cjs',
    '.cmd',
    '.css',
    '.cts',
    '.env',
    '.gitignore',
    '.html',
    '.ini',
    '.js',
    '.json',
    '.jsonl',
    '.md',
    '.mjs',
    '.mts',
    '.ps1',
    '.scss',
    '.sh',
    '.sql',
    '.svg',
    '.toml',
    '.ts',
    '.tsx',
    '.txt',
    '.vue',
    '.xml',
    '.yaml',
    '.yml',
]);

const INCLUDE_NAMES = new Set(['.editorconfig', '.env', '.gitignore']);
const GARBLED_PATTERN = /�|锟斤拷|Ã.|Â.|â.|æ.|ç.|å.|ð./u;

function shouldInspect(filePath) {
    const base = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    return INCLUDE_NAMES.has(base) || INCLUDE_EXTENSIONS.has(ext);
}

function checkFiles(dir) {
    const issues = [];

    for (const file of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, file);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
            if (!EXCLUDE_DIRS.has(file)) {
                issues.push(...checkFiles(fullPath));
            }
            continue;
        }

        if (!shouldInspect(fullPath)) {
            continue;
        }

        if (fullPath === __filename) {
            continue;
        }

        const buffer = fs.readFileSync(fullPath);
        if (buffer.length === 0) {
            continue;
        }

        if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
            issues.push({ path: fullPath, type: 'BOM detected' });
        }

        let content = '';
        try {
            content = decoder.decode(buffer);
        } catch {
            issues.push({ path: fullPath, type: 'Invalid UTF-8 encoding' });
            continue;
        }

        if (GARBLED_PATTERN.test(content)) {
            issues.push({ path: fullPath, type: 'Potential garbled text detected' });
        }
    }

    return issues;
}

console.log('--- Starting Encoding Check ---');
const results = checkFiles(rootDir);

if (results.length > 0) {
    console.error(`Found ${results.length} encoding issues:`);
    for (const issue of results) {
        console.error(`[${issue.type}] ${path.relative(rootDir, issue.path)}`);
    }
    process.exit(1);
}

console.log('All files passed encoding check!');
