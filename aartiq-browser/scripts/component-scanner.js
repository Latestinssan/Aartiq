#!/usr/bin/env node
/**
 * Component Scanner Script
 * 
 * Automatically scans aartiq-browser/src and flutter_browser_app/lib
 * and generates line counts, metadata, and rich code analysis for documentation.
 *
 * Every entry carries a `group` (the directory it was found in) so consumers can
 * rebuild categorisation without re-deriving it from paths. Desktop covers
 * .ts/.tsx/.js; Flutter covers .dart.
 *
 * Usage:
 *   node scripts/component-scanner.js           # Scan and output JSON
 *   node scripts/component-scanner.js --update  # Update component-data.json
 *   node scripts/component-scanner.js --flutter # Scan Flutter components
 *   node scripts/component-scanner.js --missing  # Find undocumented components
 *   node scripts/component-scanner.js --all      # Scan both desktop and flutter
 *
 * Set AARTIQ_LANDING_DIR to also refresh the landing repository's
 * src/data/component-data.json in the same run (defaults to the sibling
 * Aartiq-Landing-Page checkout).
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const OUTPUT_FILE = path.join(ROOT_DIR, 'src', 'components', 'component-data.json');

// Only TypeScript files (no .js duplicates)
const EXTENSIONS = ['.ts', '.tsx'];

// Tags for auto-detection
const TAG_PATTERNS = {
  'React': /\b(react|useState|useEffect|useCallback|useMemo)\b/,
  'Node.js': /\b(fs|path|child_process|crypto)\b/,
  'Swift': /\bswift\b|import\s+\w+UI|@objc\s/,
  'SwiftUI': /SwiftUI|@State|@Binding|struct\s\w+View/,
  'Core': /\bIPC|ipcMain|ipcRenderer\b/,
  'Security': /\bsecurity|validate|sanitize|XSS\b/i,
  'AI': /\bAI|chat|model|completion\b/i,
  'Sync': /\bSync|WebSocket|QR\b/,
  'Automation': /\bautomation|robot|schedule\b/i,
  'PDF': /\bpdf|document|template\b/i,
  'OCR': /\bocr|tesseract|recognize\b/i,
  'Plugin': /\bplugin|hook|extension\b/i,
  'macOS': /\bmacos|apple|ns\w+|NS\w+/i,
  'Windows': /\bwindows|powershell|win32\b/i,
  'Linux': /\blinux|xdotool|xte\b/i,
  'Flutter': /\bFlutter|Dart|Widget|StatefulWidget\b/,
};

function extractCodeAnalysis(content, filename) {
  const ext = path.extname(filename).toLowerCase();
  const isReact = ext === '.tsx';

  // 1. Imports
  const importLines = content.match(/^import\s+.*?['"].+?['"]\s*;?\s*$/gm) || [];
  const importsExternal = [];
  const importsInternal = [];
  for (const line of importLines) {
    const match = line.match(/from\s+['"](.+)['"]/);
    if (!match) continue;
    const modulePath = match[1];
    if (modulePath.startsWith('.') || modulePath.startsWith('@/')) {
      importsInternal.push(modulePath);
    } else {
      importsExternal.push(modulePath);
    }
  }

  // 2. Interfaces & Types
  const interfaces = [];
  const interfaceRegex = /(?:export\s+)?(?:interface|type)\s+(\w+)(?:\s+extends\s+[\w<>,\s]+)?\s*\{([^}]+)\}/g;
  let ifMatch;
  while ((ifMatch = interfaceRegex.exec(content)) !== null) {
    const props = [];
    const propLines = ifMatch[2].trim().split('\n');
    for (const propLine of propLines) {
      const propMatch = propLine.match(/^\s*(\w[\w?]*)\s*(:|=)\s*([^;]+?)(;|,)?\s*$/);
      if (propMatch) {
        props.push({
          name: propMatch[1].replace('?', ''),
          type: propMatch[3].trim().replace(/[;,]\s*$/, ''),
          required: !propMatch[1].includes('?')
        });
      }
    }
    interfaces.push({ name: ifMatch[1], properties: props });
  }

  // 3. React hooks
  const hooks = [];
  const hookPatterns = [
    /useState\b/g, /useEffect\b/g, /useCallback\b/g, /useRef\b/g,
    /useMemo\b/g, /useReducer\b/g, /useContext\b/g, /useLayoutEffect\b/g,
    /useImperativeHandle\b/g, /useDebugValue\b/g, /useTransition\b/g,
    /useDeferredValue\b/g, /useSyncExternalStore\b/g,
    /useId\b/g, /useShallow\b/g,
  ];
  for (const pattern of hookPatterns) {
    if (pattern.test(content)) {
      const name = pattern.source.replace(/\\b/g, '');
      if (!hooks.includes(name)) hooks.push(name);
    }
  }

  // 4. Component type detection
  let componentType = 'utility';
  if (isReact) {
    const hasFunctionComponent = /(?:const|function)\s+\w+\s*(?:=\s*\([^)]*\)|\s*\([^)]*\))\s*(?::\s*[^{]+)?\s*=>/.test(content) ||
      /export\s+default\s+function\s+\w+\s*\(/.test(content);
    const hasClassComponent = /extends\s+(?:React\.)?(?:Component|PureComponent)/.test(content);
    if (hasClassComponent) componentType = 'class-component';
    else if (hasFunctionComponent) componentType = 'function-component';
    else componentType = 'react-utility';
  } else if (content.includes('export default') || content.includes('module.exports')) {
    componentType = 'service';
  }

  // 5. Exports
  const exports = [];
  const defaultExport = content.match(/export\s+default\s+(?:function\s+)?(\w+)/);
  if (defaultExport) exports.push(`default ${defaultExport[1]}`);
  const namedExports = content.matchAll(/export\s+(?:const|function|class|interface|type)\s+(\w+)/g);
  for (const m of namedExports) {
    if (!exports.includes(`default ${m[1]}`)) exports.push(m[1]);
  }

  // 6. API usage detection
  const apiUsage = [];
  if (/\belectronAPI\b/.test(content)) apiUsage.push('electronAPI');
  if (/\buseRouter\b|\brouter\.\b/.test(content)) apiUsage.push('router');
  if (/\buseAppStore\b|\buseUIStore\b|\buseStore\b/.test(content)) apiUsage.push('zustand-store');
  if (/\bfirebase\b|\bFirebaseService\b/.test(content)) apiUsage.push('firebase');
  if (/\bframer-motion\b|\bmotion\.\b|\bAnimatePresence\b/.test(content)) apiUsage.push('framer-motion');
  if (/\bnext\/navigation\b/.test(content)) apiUsage.push('next-navigation');
  if (/\bDOMPurify\b/.test(content)) apiUsage.push('dompurify');
  if (/\breact-markdown\b|\bremark-\b|\brehype-\b/.test(content)) apiUsage.push('markdown');
  if (/\bTesseract\b|\btesseract\.js\b/.test(content)) apiUsage.push('tesseract-ocr');
  if (/\breact-syntax-highlighter\b/.test(content)) apiUsage.push('syntax-highlight');
  if (/\bWebSocket\b|\bws\b/.test(content)) apiUsage.push('websocket');
  if (/\blucide-react\b/.test(content)) apiUsage.push('lucide-icons');

  // 7. Key functions (named function declarations and const arrow functions)
  const keyFunctions = [];
  const funcMatches = content.matchAll(/(?:const|function|let|var)\s+(\w+)\s*(?:=\s*(?:\([^)]*\)|[^=])\s*(?::[^{]+)?\s*(?:=>|\{)|\([^)]*\)\s*\{)/g);
  for (const m of funcMatches) {
    const name = m[1];
    if (!keyFunctions.includes(name) && !exports.includes(name) && !exports.includes(`default ${name}`)) {
      keyFunctions.push(name);
    }
  }

  // Deduplicate external imports
  const uniqueExternal = [...new Set(importsExternal)];
  const uniqueInternal = [...new Set(importsInternal)];

  return {
    importsExternal: uniqueExternal,
    importsInternal: uniqueInternal,
    interfaces,
    hooks,
    componentType,
    exports,
    apiUsage,
    keyFunctions
  };
}

function detectTags(content, filename) {
  const tags = [];
  const ext = path.extname(filename).toLowerCase();
  
  if (ext === '.tsx') tags.push('React');
  if (ext === '.dart') tags.push('Flutter');
  
  for (const [tag, pattern] of Object.entries(TAG_PATTERNS)) {
    if (pattern.test(content) && !tags.includes(tag)) {
      tags.push(tag);
    }
  }
  
  return tags;
}

function countLines(filepath) {
  try {
    const content = fs.readFileSync(filepath, 'utf8');
    return content.split('\n').length;
  } catch (err) {
    return 0;
  }
}

function getDescription(filepath) {
  try {
    const content = fs.readFileSync(filepath, 'utf8');
    const jsdocMatch = content.match(/\/\*\*[\s\S]*?\*\//);
    if (jsdocMatch) {
      const descMatch = jsdocMatch[0].match(/@description\s+(.+)/);
      if (descMatch) return descMatch[1].trim().slice(0, 100);
    }
    return '';
  } catch (err) {
    return '';
  }
}

function scanDirectory(dir, baseDir = dir) {
  const results = [];
  
  if (!fs.existsSync(dir)) {
    return results;
  }
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || 
          entry.name === 'node_modules' ||
          entry.name === '__pycache__') {
        continue;
      }
      results.push(...scanDirectory(fullPath, baseDir));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      // TypeScript/JavaScript for desktop, Dart for Flutter. Plain .js matters:
      // the main-process services, the automation backends and src/service are
      // all .js, and skipping them silently emptied the core/automation/service
      // groups in the generated JSON.
      const isDesktop = dir.includes('/src/') || dir.includes('\\src\\');
      const validExts = isDesktop ? ['.ts', '.tsx', '.js'] : ['.dart'];

      if (validExts.includes(ext)) {
        results.push(scanFile(fullPath, path.relative(baseDir, fullPath)));
      }
    }
  }
  
  return results;
}

/** Build one inventory entry for a file that is known to be scannable. */
function scanFile(fullPath, relativePath, group = null) {
  const filename = path.basename(fullPath);
  const content = fs.readFileSync(fullPath, 'utf8');
  const tags = detectTags(content, filename);
  const description = getDescription(fullPath) || guessDescription(filename);
  const codeAnalysis = extractCodeAnalysis(content, filename);

  return {
    name: filename,
    path: String(relativePath).replace(/\\/g, '/'),
    lines: countLines(fullPath),
    description,
    tags,
    lastModified: fs.statSync(fullPath).mtime.toISOString().split('T')[0],
    codeAnalysis,
    group,
  };
}

function guessDescription(filepath) {
  const filename = path.basename(filepath, path.extname(filepath));
  
  const patterns = [
    { pattern: /([A-Z][a-z]+(?:[A-Z][a-z]+)+)/, transform: (m) => m.replace(/([A-Z])/g, ' $1').trim() },
    { pattern: /^(\w+)Page$/, transform: (m) => `${m.replace('Page', '')} page component` },
    { pattern: /^(\w+)Panel$/, transform: (m) => `${m.replace('Panel', '')} panel` },
    { pattern: /^(\w+)Modal$/, transform: (m) => `${m.replace('Modal', '')} modal dialog` },
    { pattern: /^(\w+)Settings$/, transform: (m) => `${m.replace('Settings', '')} settings` },
    { pattern: /^(\w+)Overlay$/, transform: (m) => `${m.replace('Overlay', '')} overlay` },
    { pattern: /^(\w+)Service$/, transform: (m) => `${m.replace('Service', '')} service` },
    { pattern: /^(\w+)Manager$/, transform: (m) => `${m.replace('Manager', '')} manager` },
  ];
  
  for (const { pattern, transform } of patterns) {
    const match = filename.match(pattern);
    if (match) return transform(match[0]);
  }
  
  return filename.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function scanDesktop() {
  console.log('🔍 Scanning desktop components...\n');
  
  const dirs = {
    components: path.join(ROOT_DIR, 'src', 'components'),
    core: path.join(ROOT_DIR, 'src', 'core'),
    automation: path.join(ROOT_DIR, 'src', 'automation'),
    service: path.join(ROOT_DIR, 'src', 'service'),
    lib: path.join(ROOT_DIR, 'src', 'lib'),
    app: path.join(ROOT_DIR, 'src', 'app'),
    hooks: path.join(ROOT_DIR, 'src', 'hooks'),
    main: path.join(ROOT_DIR, 'src', 'main'),
    store: path.join(ROOT_DIR, 'src', 'store'),
    stores: path.join(ROOT_DIR, 'src', 'stores'),
    workers: path.join(ROOT_DIR, 'src', 'workers'),
  };
  
  const results = {};
  for (const [name, dir] of Object.entries(dirs)) {
    // Each entry carries the group it was found in, so consumers rebuild
    // categorisation from data instead of re-deriving it from paths.
    results[name] = scanDirectory(dir).map((c) => ({ ...c, group: name }));
    console.log(`   - ${name}: ${results[name].length} files`);
  }

  // The entry-point scripts live at the repository root, outside src/, so the
  // directory walk above cannot see them. Listed explicitly — the root also
  // holds jest/next configs and one-off dev scripts that are not components.
  results.root = [
    'main.js',
    'preload.js',
    'approval-preload.js',
    'auth-preload.js',
    'view_preload.js',
  ]
    .filter((f) => fs.existsSync(path.join(ROOT_DIR, f)))
    .map((f) => scanFile(path.join(ROOT_DIR, f), f, 'root'));
  console.log(`   - root: ${results.root.length} files`);
  
  const all = Object.values(results).flat();
  console.log(`\n✅ Total desktop: ${all.length} components`);
  console.log(`   Total lines: ${all.reduce((s, c) => s + c.lines, 0).toLocaleString()}`);
  
  return { results, all };
}

function scanFlutter() {
  const flutterDir = path.join(ROOT_DIR, '..', 'flutter_browser_app', 'lib');
  
  if (!fs.existsSync(flutterDir)) {
    console.log('⚠️ Flutter app not found at:', flutterDir);
    return { results: {}, all: [] };
  }
  
  console.log('\n🔍 Scanning Flutter components...\n');
  
  const results = {
    pages: scanDirectory(path.join(flutterDir, 'pages')),
    appBar: scanDirectory(path.join(flutterDir, 'app_bar')),
    models: scanDirectory(path.join(flutterDir, 'models')),
    root: scanDirectory(path.join(flutterDir)),
  };
  
  // Get total by excluding root files that are also in subdirs
  const subdirFiles = [
    ...(results.pages || []),
    ...(results.appBar || []),
    ...(results.models || []),
  ].map(f => f.name);
  
  results.root = results.root.filter(f => !subdirFiles.includes(f.name));

  // Tag every entry with its group, and build byCategory from the groups that
  // actually exist — the old hard-coded map named groups this scan never
  // produces (services/components/main), so pages and app_bar counts vanished.
  for (const key of Object.keys(results)) {
    results[key] = results[key].map((c) => ({ ...c, group: key }));
  }

  for (const [name, files] of Object.entries(results)) {
    console.log(`   - ${name}: ${files.length} files`);
  }
  
  const all = Object.values(results).flat();
  console.log(`\n✅ Total Flutter: ${all.length} components`);
  console.log(`   Total lines: ${all.reduce((s, c) => s + c.lines, 0).toLocaleString()}`);
  
  return { results, all };
}

function getDocumentedComponents() {
  const landingDir = process.env.AARTIQ_LANDING_DIR ||
    path.join(ROOT_DIR, '..', 'Aartiq-Landing-Page');
  const landingPagePath = path.join(landingDir, 'src', 'app', 'docs', 'components', 'page.tsx');
  
  if (!fs.existsSync(landingPagePath)) {
    return new Set();
  }
  
  const content = fs.readFileSync(landingPagePath, 'utf8');
  const documented = new Set();
  
  const matches = content.matchAll(/name:\s*["']([^"']+)["']/g);
  for (const match of matches) {
    documented.add(match[1].toLowerCase());
  }
  
  return documented;
}

function findMissing(allComponents, documented) {
  return allComponents.filter(comp => {
    const nameLower = comp.name.toLowerCase().replace(/\.(ts|tsx|js|dart)$/, '');
    const pathLower = comp.path.toLowerCase().replace(/\.(ts|tsx|js|dart)$/, '');
    return !documented.has(nameLower) && !documented.has(pathLower);
  });
}

function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--update') ? 'update' 
    : args.includes('--flutter') ? 'flutter'
    : args.includes('--missing') ? 'missing'
    : args.includes('--all') ? 'all'
    : 'desktop';
  
  let desktopData = { all: [] };
  let flutterData = { all: [] };
  
  if (mode === 'all' || mode === 'flutter') {
    flutterData = scanFlutter();
  }
  
  if (mode === 'all' || mode !== 'flutter') {
    desktopData = scanDesktop();
  }
  
  const allComponents = [...desktopData.all, ...flutterData.all];
  
  const data = {
    generated: new Date().toISOString(),
    version: require(path.join(ROOT_DIR, 'package.json')).version,
    desktop: {
      total: desktopData.all.length,
      totalLines: desktopData.all.reduce((s, c) => s + c.lines, 0),
      byCategory: Object.fromEntries(
        Object.entries(desktopData.results || {}).map(([k, v]) => [k, v.length]),
      ),
      components: desktopData.all
    },
    flutter: {
      total: flutterData.all?.length || 0,
      totalLines: flutterData.all?.reduce((s, c) => s + c.lines, 0) || 0,
      byCategory: Object.fromEntries(
        Object.entries(flutterData.results || {}).map(([k, v]) => [k, v.length]),
      ),
      components: flutterData.all || []
    },
    summary: {
      total: allComponents.length,
      totalLines: allComponents.reduce((s, c) => s + c.lines, 0),
    }
  };
  
  if (mode === 'missing') {
    const documented = getDocumentedComponents();
    const missing = findMissing(allComponents, documented);
    
    console.log(`\n📖 Documented: ${documented.size}`);
    console.log(`❌ Undocumented: ${missing.length}`);
    
    if (missing.length > 0 && missing.length <= 50) {
      console.log('\nMissing components:');
      const byCategory = {};
      for (const comp of missing) {
        const cat = comp.path.split('/')[0];
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(comp);
      }
      for (const [cat, comps] of Object.entries(byCategory)) {
        console.log(`  ${cat}/: ${comps.map(c => c.name).join(', ')}`);
      }
    }
    
    return data;
  }
  
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
  console.log(`\n💾 Saved to: ${OUTPUT_FILE}`);

  // The canonical landing repository renders this file directly — refresh its
  // copy in the same run so the site cannot publish a stale inventory.
  const LANDING_DIR = process.env.AARTIQ_LANDING_DIR ||
    path.join(ROOT_DIR, '..', 'Aartiq-Landing-Page');
  const LANDING_DATA_DIR = path.join(LANDING_DIR, 'src', 'data');
  if (fs.existsSync(LANDING_DATA_DIR)) {
    const landingOutput = path.join(LANDING_DATA_DIR, 'component-data.json');
    fs.writeFileSync(landingOutput, JSON.stringify(data, null, 2));
    console.log(`🚀 Also synced to landing repo: ${landingOutput}`);
  } else {
    console.log(`\nℹ️  Skipped landing repo sync: ${LANDING_DATA_DIR} not found.`);
  }
  
  console.log('\n📈 Top 10 Largest:');
  const sorted = [...allComponents].sort((a, b) => b.lines - a.lines);
  sorted.slice(0, 10).forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.name} - ${c.lines.toLocaleString()} lines`);
  });
  
  return data;
}

main();
