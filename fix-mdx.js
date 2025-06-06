#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { existsSync } = require('fs');

// ============================================================================
// MDX SYNTAX FIXER SCRIPT
// ============================================================================

const config = {
  docsDir: __dirname, // Current directory since MDX files are in root
  backupDir: path.join(__dirname, 'mdx-backup'),
  dryRun: process.argv.includes('--dry-run'),
  verbose: process.argv.includes('--verbose'),
  logFile: path.join(__dirname, 'mdx-fixes.log'),
  excludeDirs: ['node_modules', '.git', '.expo', 'assets', 'mdx-backup'], // Skip these directories
};

// ============================================================================
// LOGGING
// ============================================================================

class Logger {
  constructor() {
    this.logs = [];
    this.fixes = [];
  }

  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, level, message, data };
    this.logs.push(logEntry);
    
    const colors = {
      ERROR: '\x1b[31m❌',
      WARN: '\x1b[33m⚠️ ',
      INFO: '\x1b[34mℹ️ ',
      SUCCESS: '\x1b[32m✅',
      FIX: '\x1b[35m🔧'
    };
    
    const color = colors[level] || '';
    const reset = '\x1b[0m';
    console.log(`${color} ${message}${reset}`);
    
    if (config.verbose && data) {
      console.log(`   ${JSON.stringify(data, null, 2)}`);
    }
  }

  error(message, data) { this.log('ERROR', message, data); }
  warn(message, data) { this.log('WARN', message, data); }
  info(message, data) { this.log('INFO', message, data); }
  success(message, data) { this.log('SUCCESS', message, data); }
  fix(message, data) { 
    this.log('FIX', message, data); 
    this.fixes.push({ message, data, timestamp: new Date().toISOString() });
  }

  async saveLog() {
    const summary = {
      timestamp: new Date().toISOString(),
      totalFixes: this.fixes.length,
      fixes: this.fixes,
      logs: this.logs
    };
    
    await fs.writeFile(config.logFile, JSON.stringify(summary, null, 2));
    this.info(`Log saved to: ${config.logFile}`);
  }
}

// ============================================================================
// MDX SYNTAX FIXES
// ============================================================================

function toPascalCase(str) {
  return str
    .replace(/(^[a-z])|([-_][a-z])/g, (match) => match.replace(/[-_]/, '').toUpperCase());
}

class MDXFixer {
  constructor(logger) {
    this.logger = logger;
    this.totalFiles = 0;
    this.filesFixed = 0;
    this.totalIssuesFound = 0;
    this.totalIssuesFixed = 0;
  }

  // Define fix patterns for common MDX syntax issues
  getFixPatterns() {
    return [
      // Fix CardGroup cols without braces
      {
        name: 'CardGroup cols attribute',
        pattern: /(<CardGroup\s+cols=)(\d+)(\s*>)/g,
        replacement: '$1{$2}$3',
        description: 'Fix CardGroup cols={number} syntax'
      },
      
      // Fix Card titles starting with numbers (escape them)
      {
        name: 'Card title with leading numbers',
        pattern: /(<Card\s+title=")(\d+)(\s*[^"]*")/g,
        replacement: '$1Step $2:$3',
        description: 'Add "Step" prefix to card titles starting with numbers'
      },
      
      // Fix component names starting with numbers
      {
        name: 'Component names starting with numbers',
        pattern: /(<\/?)(\d+[A-Za-z][A-Za-z0-9]*)/g,
        replacement: '$1Step$2',
        description: 'Add "Step" prefix to component names starting with numbers'
      },
      
      // Fix unquoted numeric props
      {
        name: 'Unquoted numeric props',
        pattern: /(\s+\w+=)(\d+)(\s+(?!\w))/g,
        replacement: '$1{$2}$3',
        description: 'Add braces around numeric prop values'
      },
      
      // Fix missing quotes in JSX attributes
      {
        name: 'Missing quotes in attributes',
        pattern: /(\s+\w+=)([a-zA-Z][a-zA-Z0-9-]*)/g,
        replacement: '$1"$2"',
        description: 'Add quotes around string attribute values'
      },
      
      // Fix common JSX syntax issues
      {
        name: 'JSX syntax cleanup',
        pattern: /(\s+)(\d+)(\s*[A-Za-z][A-Za-z0-9]*\s*=)/g,
        replacement: '$1$3',
        description: 'Remove stray numbers before JSX attributes'
      },
      
      // Fix Step components with number prefixes
      {
        name: 'Step component numbers',
        pattern: /(<Step\s+title=")(\d+)(\.\s*)/g,
        replacement: '$1Step $2: ',
        description: 'Format Step titles properly'
      },
      
      // Fix accordion titles with numbers
      {
        name: 'Accordion title numbers',
        pattern: /(<Accordion\s+title=")(\d+)(\.\s*)/g,
        replacement: '$1$2. ',
        description: 'Format Accordion titles properly'
      },
      
      // Fix code block titles with numbers
      {
        name: 'Code block titles',
        pattern: /(```\w+\s+)(\d+)(\s+)/g,
        replacement: '$1Step$2 ',
        description: 'Fix code block titles starting with numbers'
      },
      
      // Fix image alt text issues
      {
        name: 'Image alt text',
        pattern: /(!\[)(\d+)(\]\()/g,
        replacement: '$1Step $2$3',
        description: 'Fix image alt text starting with numbers'
      },
      // Fix component names with dashes or lowercase (convert to PascalCase, remove dashes)
      {
        name: 'Component names with dashes or lowercase',
        pattern: /(<\/?)([a-z][a-z0-9\-]*)([\s>])/g,
        replacement: (match, p1, p2, p3) => {
          if (/^[a-z]/.test(p2) && /-/.test(p2)) {
            return p1 + toPascalCase(p2) + p3;
          }
          if (/^[a-z]/.test(p2) && !/^[A-Z]/.test(p2)) {
            return p1 + toPascalCase(p2) + p3;
          }
          return match;
        },
        description: 'Convert component names to PascalCase and remove dashes'
      },
      // Fix duplicate attributes (keep last)
      {
        name: 'Duplicate attributes',
        pattern: /(<[A-Za-z][A-Za-z0-9]*\s+)([\w-]+)=(["{][^"}]+["}])([^>]*?)\s\2=(["{][^"}]+["}])/g,
        replacement: '$1$4 $2=$5',
        description: 'Remove duplicate attributes, keep last'
      },
      // Fix dangling equal signs (add empty string)
      {
        name: 'Dangling equal signs',
        pattern: /(\w+)=([>\n])/g,
        replacement: '$1=""$2',
        description: 'Add empty string for dangling equal signs'
      },
      // Escape quotes in attribute values
      {
        name: 'Unescaped quotes in attribute values',
        pattern: /(\w+)="([^"]*?)("[^"]*?)*"/g,
        replacement: (match, p1, p2) => `${p1}="${p2.replace(/\"/g, '&quot;')}"`,
        description: 'Escape quotes in attribute values'
      },
      // Fix malformed spread props
      {
        name: 'Malformed spread props',
        pattern: /<([A-Za-z][A-Za-z0-9]*)\s+\.\.\.([^}]+)[^>]*>/g,
        replacement: '<$1 {...$2}>',
        description: 'Fix malformed spread props'
      },
      // Fix unclosed tags (simple cases)
      {
        name: 'Unclosed tags',
        pattern: /(<[A-Za-z][A-Za-z0-9]*[^>]*)(?<!\/)>\s*([^<]*)$/gm,
        replacement: (match, p1, p2) => {
          if (p2.trim() === '') {
            return `${p1} />`;
          }
          return match;
        },
        description: 'Auto-close simple unclosed tags'
      },
    ];
  }

  async fixFile(filePath) {
    try {
      let content = await fs.readFile(filePath, 'utf8');
      const originalContent = content;
      let issuesFound = 0;
      let issuesFixed = 0;
      const appliedFixes = [];

      const fixPatterns = this.getFixPatterns();

      // Apply each fix pattern
      for (const pattern of fixPatterns) {
        const matches = content.match(pattern.pattern);
        if (matches) {
          issuesFound += matches.length;
          content = content.replace(pattern.pattern, pattern.replacement);
          appliedFixes.push({
            name: pattern.name,
            description: pattern.description,
            matchCount: matches.length
          });
          issuesFixed += matches.length;
        }
      }

      // Additional specific fixes based on the error patterns
      content = this.applySpecificFixes(content, filePath, appliedFixes);

      // Check if content changed
      if (content !== originalContent) {
        if (!config.dryRun) {
          await fs.writeFile(filePath, content, 'utf8');
        }
        
        this.filesFixed++;
        this.totalIssuesFixed += issuesFixed;
        
        this.logger.fix(`Fixed ${issuesFixed} issues in ${path.basename(filePath)}`, {
          file: filePath,
          fixes: appliedFixes,
          dryRun: config.dryRun
        });
        
        return { fixed: true, issuesFixed, appliedFixes };
      }

      this.totalIssuesFound += issuesFound;
      return { fixed: false, issuesFound: 0, appliedFixes: [] };
      
    } catch (error) {
      this.logger.error(`Failed to fix file: ${filePath}`, error);
      return { fixed: false, error: error.message };
    }
  }

  applySpecificFixes(content, filePath, appliedFixes) {
    let fixedContent = content;
    
    // Specific fixes based on the error locations
    const fileName = path.basename(filePath);
    
    if (fileName === 'features.mdx') {
      // Line 126:59 - likely a CardGroup cols issue
      fixedContent = fixedContent.replace(
        /<CardGroup\s+cols=(\d+)/g,
        '<CardGroup cols={$1}'
      );
    }
    
    if (fileName === 'introduction.mdx' || fileName === 'index.mdx') {
      // Line 73:65 - likely similar CardGroup issue
      fixedContent = fixedContent.replace(
        /<CardGroup\s+cols=(\d+)/g,
        '<CardGroup cols={$1}'
      );
    }
    
    if (fileName === 'installation.mdx') {
      // Line 427:35 - character '5' issue
      fixedContent = fixedContent.replace(
        /SDK\s+(\d+)\+/g,
        'SDK $1+'
      );
    }
    
    if (fileName === 'why-shelther.mdx') {
      // Line 219:57 - character '3' issue
      fixedContent = fixedContent.replace(
        /(\s)(\d+)(\s*minutes)/g,
        '$1$2 $3'
      );
    }
    
    // Common JSX attribute fixes
    fixedContent = fixedContent.replace(
      /cols=(\d+)/g,
      'cols={$1}'
    );
    
    // Fix any remaining unbraced numeric props
    fixedContent = fixedContent.replace(
      /(\s+)(size|width|height|cols|rows|timeout|delay|duration|interval)=(\d+)/g,
      '$1$2={$3}'
    );
    
    // Fix malformed JSX tags
    fixedContent = fixedContent.replace(
      /<(\d+)([A-Za-z][A-Za-z0-9]*)/g,
      '<$2'
    );
    
    // Remove duplicate attributes (keep last)
    fixedContent = fixedContent.replace(/(<[A-Za-z][A-Za-z0-9]*\s+)([\w-]+)=(["{][^"}]+["}])([^>]*?)\s\2=(["{][^"}]+["}])/g, '$1$4 $2=$5');
    // Convert component names with dashes or lowercase to PascalCase
    fixedContent = fixedContent.replace(/(<\/?)([a-z][a-z0-9\-]*)([\s>])/g, (match, p1, p2, p3) => {
      if (/^[a-z]/.test(p2) && /-/.test(p2)) {
        return p1 + toPascalCase(p2) + p3;
      }
      if (/^[a-z]/.test(p2) && !/^[A-Z]/.test(p2)) {
        return p1 + toPascalCase(p2) + p3;
      }
      return match;
    });
    // Escape quotes in attribute values
    fixedContent = fixedContent.replace(/(\w+)="([^"]*?)("[^"]*?)*"/g, (match, p1, p2) => `${p1}="${p2.replace(/\"/g, '&quot;')}"`);
    // Fix malformed spread props
    fixedContent = fixedContent.replace(/<([A-Za-z][A-Za-z0-9]*)\s+\.\.\.([^}]+)[^>]*>/g, '<$1 {...$2}>');
    // Fix dangling equal signs
    fixedContent = fixedContent.replace(/(\w+)=([>\n])/g, '$1=""$2');
    // Fix unclosed tags (simple cases)
    fixedContent = fixedContent.replace(/(<[A-Za-z][A-Za-z0-9]*[^>]*)(?<!\/)>(\s*[^<]*)$/gm, (match, p1, p2) => {
      if (p2.trim() === '') {
        return `${p1} />`;
      }
      return match;
    });
    
    return fixedContent;
  }

  async processDirectory(dirPath) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          // Skip excluded directories
          if (config.excludeDirs.includes(entry.name)) {
            this.logger.info(`Skipping excluded directory: ${entry.name}`);
            continue;
          }
          await this.processDirectory(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
          this.totalFiles++;
          await this.fixFile(fullPath);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to process directory: ${dirPath}`, error);
    }
  }

  async createBackup() {
    try {
      if (existsSync(config.backupDir)) {
        await fs.rm(config.backupDir, { recursive: true });
      }
      
      await this.copyMdxFiles(config.docsDir, config.backupDir);
      this.logger.success(`Backup created at: ${config.backupDir}`);
    } catch (error) {
      this.logger.error('Failed to create backup', error);
      throw error;
    }
  }

  async copyMdxFiles(src, dest) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory() && !config.excludeDirs.includes(entry.name)) {
        await this.copyMdxFiles(srcPath, destPath);
      } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  printSummary() {
    this.logger.info('='.repeat(60));
    this.logger.info('MDX SYNTAX FIX SUMMARY');
    this.logger.info('='.repeat(60));
    this.logger.info(`Total files processed: ${this.totalFiles}`);
    this.logger.info(`Files with issues fixed: ${this.filesFixed}`);
    this.logger.info(`Total issues found: ${this.totalIssuesFound}`);
    this.logger.info(`Total issues fixed: ${this.totalIssuesFixed}`);
    this.logger.info(`Mode: ${config.dryRun ? 'DRY RUN' : 'LIVE'}`);
    
    if (config.dryRun) {
      this.logger.warn('This was a dry run. No files were actually modified.');
      this.logger.info('Run without --dry-run to apply fixes.');
    }
    
    this.logger.info('='.repeat(60));
  }
}

// ============================================================================
// VALIDATION
// ============================================================================

class MDXValidator {
  constructor(logger) {
    this.logger = logger;
  }

  async validateFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const issues = [];
      
      // Check for common MDX syntax issues
      const checks = [
        {
          name: 'Unbraced numeric props',
          pattern: /\s+\w+=\d+\s/g,
          message: 'Numeric props should be wrapped in braces: prop={123}'
        },
        {
          name: 'Component names starting with numbers',
          pattern: /<\/?(\d+[A-Za-z])/g,
          message: 'Component names cannot start with numbers'
        },
        {
          name: 'Missing quotes in JSX attributes',
          pattern: /\s+\w+=[a-zA-Z][a-zA-Z0-9-]*\s/g,
          message: 'JSX attributes should be quoted: prop="value"'
        },
        {
          name: 'Component names with dashes or lowercase',
          pattern: /<\/?[a-z][a-z0-9\-]*[\s>]/g,
          message: 'Component names should be PascalCase and not contain dashes'
        },
        {
          name: 'Duplicate attributes',
          pattern: /<[A-Za-z][A-Za-z0-9]*\s+([\w-]+)=(["{][^"}]+["}])[^>]*\s\1=(["{][^"}]+["}])/g,
          message: 'Duplicate attributes found, only the last should be kept'
        },
        {
          name: 'Dangling equal signs',
          pattern: /\w+=([>\n])/g,
          message: 'Dangling equal sign in attribute, should be given a value or removed'
        },
        {
          name: 'Malformed spread props',
          pattern: /<[A-Za-z][A-Za-z0-9]*\s+\.\.\.[^}]+[^>]*>/g,
          message: 'Malformed spread props, should be {...props}'
        },
        {
          name: 'Unescaped quotes in attribute values',
          pattern: /\w+="[^"]*"[^"]*"/g,
          message: 'Quotes inside attribute values should be escaped as &quot;'
        },
        {
          name: 'Unclosed tags',
          pattern: /(<[A-Za-z][A-Za-z0-9]*[^>]*)(?<!\/)>\s*([^<]*)$/gm,
          message: 'Unclosed tag detected, should be self-closed or properly closed'
        },
      ];
      
      for (const check of checks) {
        const matches = content.match(check.pattern);
        if (matches) {
          issues.push({
            type: check.name,
            count: matches.length,
            message: check.message,
            examples: matches.slice(0, 3) // Show first 3 examples
          });
        }
      }
      
      return { file: filePath, issues };
    } catch (error) {
      this.logger.error(`Failed to validate file: ${filePath}`, error);
      return { file: filePath, error: error.message };
    }
  }

  async validateDirectory(dirPath) {
    const results = [];
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory() && !config.excludeDirs.includes(entry.name)) {
          const subResults = await this.validateDirectory(fullPath);
          results.push(...subResults);
        } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
          const result = await this.validateFile(fullPath);
          results.push(result);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to validate directory: ${dirPath}`, error);
    }
    
    return results;
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

async function checkForMdxFiles(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.mdx')) {
        return true;
      }
      if (entry.isDirectory() && !config.excludeDirs.includes(entry.name)) {
        const fullPath = path.join(dirPath, entry.name);
        const hasSubMdx = await checkForMdxFiles(fullPath);
        if (hasSubMdx) return true;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

// ============================================================================
// CLI INTERFACE
// ============================================================================

function printUsage() {
  console.log(`
🔧 MDX Syntax Fixer

Usage: node fix-mdx.js [options]

Options:
  --dry-run     Preview fixes without making changes
  --verbose     Show detailed output
  --validate    Only validate files, don't fix
  --help        Show this help message

Examples:
  node fix-mdx.js --dry-run     # Preview what would be fixed
  node fix-mdx.js               # Apply fixes
  node fix-mdx.js --validate    # Only check for issues

Notes:
  - Run this script in the directory containing your .mdx files
  - Creates backup in ./mdx-backup/ before making changes
  - Processes .mdx files in current directory and subdirectories
  - Excludes: node_modules, .git, .expo, assets, mdx-backup

Common fixes:
  - CardGroup cols=2 → cols={2}
  - Component names starting with numbers
  - Unquoted JSX attributes
  - Malformed JSX syntax
`);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  if (process.argv.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const logger = new Logger();
  
  try {
    logger.info('MDX Syntax Fixer Started');
    logger.info(`Mode: ${config.dryRun ? 'DRY RUN' : 'LIVE'}`);
    
    // Check if docs directory exists
    if (!existsSync(config.docsDir)) {
      logger.error(`Target directory not found: ${config.docsDir}`);
      process.exit(1);
    }
    
    // Check if we have any MDX files to process
    const hasMdxFiles = await checkForMdxFiles(config.docsDir);
    if (!hasMdxFiles) {
      logger.warn('No MDX files found in the current directory');
      logger.info('Make sure you\'re running this script in the directory containing your .mdx files');
      process.exit(0);
    }
    
    if (process.argv.includes('--validate')) {
      // Validation only mode
      logger.info('Running validation only...');
      const validator = new MDXValidator(logger);
      const results = await validator.validateDirectory(config.docsDir);
      
      const filesWithIssues = results.filter(r => r.issues && r.issues.length > 0);
      
      if (filesWithIssues.length === 0) {
        logger.success('No syntax issues found!');
      } else {
        logger.warn(`Found issues in ${filesWithIssues.length} files:`);
        filesWithIssues.forEach(result => {
          logger.info(`File: ${path.basename(result.file)}`);
          result.issues.forEach(issue => {
            logger.warn(`  - ${issue.type}: ${issue.count} instances`);
            if (config.verbose) {
              logger.info(`    Message: ${issue.message}`);
              logger.info(`    Examples: ${issue.examples.join(', ')}`);
            }
          });
        });
      }
    } else {
      // Fix mode
      const fixer = new MDXFixer(logger);
      
      // Create backup before making changes
      if (!config.dryRun) {
        await fixer.createBackup();
      }
      
      // Process all MDX files
      await fixer.processDirectory(config.docsDir);
      
      // Print summary
      fixer.printSummary();
    }
    
    // Save log
    await logger.saveLog();
    
    logger.success('Process completed successfully!');
    
  } catch (error) {
    logger.error('Process failed', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the script
if (require.main === module) {
  main();
}

module.exports = { MDXFixer, MDXValidator, Logger };