#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { existsSync, mkdirSync } = require('fs');

// ============================================================================
// CONFIGURATION - CORRECTED FOR ROOT DIRECTORY
// ============================================================================

const config = {
  input: path.join(__dirname, 'docs.json'),
  output: __dirname, // ✅ CORRECTED: Output to root directory, not docs/
  dryRun: process.argv.includes('--dry-run'),
  force: process.argv.includes('--force'),
  verbose: process.argv.includes('--verbose'),
  logFile: path.join(__dirname, 'docs-generator.log'),
  
  // Excluded files/folders to avoid overwriting important files
  excludePatterns: [
    'docs.json',
    'package.json',
    'package-lock.json',
    'node_modules',
    '.git',
    '.gitignore',
    'README.md', // We'll generate docs-specific README
    'generate-docs.js',
    'move-files.js',
    'workflow.js',
    'docs-generator.log'
  ],
  
  templates: {
    basicPage: {
      frontmatter: {
        title: '',
        description: '',
        sidebarTitle: null
      },
      content: `## Overview

This page is automatically generated from the Mintlify docs.json structure.

<Info>
Add your content here following Mintlify's MDX guidelines.
</Info>

## Key Points

- Add comprehensive content for this section
- Include code examples where relevant
- Add proper cross-references to related pages

## Examples

<CodeGroup>

\`\`\`typescript TypeScript
// Add relevant code examples
interface ExampleInterface {
  id: string;
  name: string;
}
\`\`\`

\`\`\`javascript JavaScript
// JavaScript example
const example = {
  id: '1',
  name: 'Example'
};
\`\`\`

</CodeGroup>

## Next Steps

<CardGroup cols={2}>
  <Card title="Related Topic" icon="link" href="/related-page">
    Description of related topic
  </Card>
  <Card title="Implementation Guide" icon="code" href="/implementation">
    Step-by-step implementation guide
  </Card>
</CardGroup>

---

<Note>
This page was generated automatically. Update the content to match your documentation requirements.
</Note>`
    },
    apiPage: {
      frontmatter: {
        title: '',
        description: '',
        api: ''
      },
      content: `## Endpoint Description

Detailed description of this API endpoint and its purpose in the Shelther safety platform.

## Authentication

<Info>
This endpoint requires authentication using a valid JWT token.
</Info>

\`\`\`bash
Authorization: Bearer YOUR_JWT_TOKEN
\`\`\`

## Parameters

<ParamField path="parameter_name" type="string" required>
  Description of the required parameter
</ParamField>

<ParamField path="optional_param" type="number">
  Description of the optional parameter
</ParamField>

## Request Body

<ParamField body="field_name" type="string" required>
  Description of the request body field
</ParamField>

## Response

<ResponseField name="success" type="boolean">
  Indicates if the request was successful
</ResponseField>

<ResponseField name="data" type="object">
  The response data object
</ResponseField>

## Code Examples

<CodeGroup>

\`\`\`bash cURL
curl -X POST "https://api.shelther.app/v1/endpoint" \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "parameter_name": "value"
  }'
\`\`\`

\`\`\`javascript JavaScript
const response = await fetch('https://api.shelther.app/v1/endpoint', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    parameter_name: 'value'
  })
});

const data = await response.json();
\`\`\`

\`\`\`typescript TypeScript
interface RequestBody {
  parameter_name: string;
}

interface ResponseData {
  success: boolean;
  data: any;
}

const response = await api.post<ResponseData>('/endpoint', {
  parameter_name: 'value'
} as RequestBody);
\`\`\`

</CodeGroup>

## Error Responses

| Status Code | Description |
|-------------|-------------|
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Invalid or missing token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource not found |
| 500 | Internal Server Error |

<ResponseExample>
\`\`\`json Error Response
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Parameter validation failed",
    "details": "parameter_name is required"
  }
}
\`\`\`
</ResponseExample>`
    }
  }
};

// ============================================================================
// LOGGING UTILITIES
// ============================================================================

class Logger {
  constructor(logFile) {
    this.logFile = logFile;
    this.logs = [];
    this.startTime = new Date();
  }

  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data: data ? JSON.stringify(data, null, 2) : null
    };
    
    this.logs.push(logEntry);
    
    // Console output with colors
    const colors = {
      ERROR: '\x1b[31m❌',   // Red
      WARN: '\x1b[33m⚠️ ',   // Yellow  
      INFO: '\x1b[34mℹ️ ',   // Blue
      SUCCESS: '\x1b[32m✅', // Green
      DEBUG: '\x1b[90m🔍'    // Gray
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
  debug(message, data) { this.log('DEBUG', message, data); }

  async saveToFile() {
    try {
      const summary = {
        startTime: this.startTime,
        endTime: new Date(),
        duration: new Date() - this.startTime,
        totalLogs: this.logs.length,
        errorCount: this.logs.filter(l => l.level === 'ERROR').length,
        warningCount: this.logs.filter(l => l.level === 'WARN').length,
        logs: this.logs
      };
      
      await fs.writeFile(this.logFile, JSON.stringify(summary, null, 2));
      this.info(`Log saved to: ${this.logFile}`);
    } catch (error) {
      this.error('Failed to save log file', error);
    }
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

class Utils {
  static sanitizeFilename(str) {
    if (!str || typeof str !== 'string') return 'untitled';
    
    return str
      .toLowerCase()
      .replace(/[^a-z0-9\-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  static async ensureDirectory(dirPath) {
    try {
      if (!existsSync(dirPath)) {
        await fs.mkdir(dirPath, { recursive: true });
        return true;
      }
      return false;
    } catch (error) {
      throw new Error(`Failed to create directory ${dirPath}: ${error.message}`);
    }
  }

  static generateFrontmatter(metadata) {
    const lines = ['---'];
    
    Object.entries(metadata).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        if (typeof value === 'string') {
          lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
        } else {
          lines.push(`${key}: ${JSON.stringify(value)}`);
        }
      }
    });
    
    lines.push('---', '');
    return lines.join('\n');
  }

  static inferPageType(pagePath) {
    if (pagePath.includes('/api-reference/') || pagePath.startsWith('api-reference/')) {
      return 'api';
    }
    return 'basic';
  }

  static generatePageTitle(pagePath, groupContext = []) {
    const filename = path.basename(pagePath);
    
    const title = filename
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    
    return title;
  }

  static generateDescription(pagePath, groupContext = []) {
    const title = this.generatePageTitle(pagePath);
    const context = groupContext.length > 0 ? ` for ${groupContext.join(' > ')}` : '';
    
    return `${title} documentation${context}. Learn about implementation, configuration, and best practices.`;
  }

  static isExcluded(filePath) {
    const fileName = path.basename(filePath);
    return config.excludePatterns.some(pattern => {
      if (pattern.includes('/')) {
        return filePath.includes(pattern);
      }
      return fileName === pattern;
    });
  }
}

// ============================================================================
// DOCS GENERATOR
// ============================================================================

class DocsGenerator {
  constructor(logger) {
    this.logger = logger;
    this.stats = {
      filesCreated: 0,
      directoriesCreated: 0,
      filesSkipped: 0,
      errors: 0
    };
    this.processedPaths = new Set();
  }

  async loadDocsJson() {
    try {
      this.logger.info(`Loading docs.json from: ${config.input}`);
      
      if (!existsSync(config.input)) {
        throw new Error(`docs.json not found at: ${config.input}`);
      }
      
      const rawData = await fs.readFile(config.input, 'utf8');
      const jsonData = JSON.parse(rawData);
      
      if (!jsonData.navigation || !Array.isArray(jsonData.navigation.groups)) {
        throw new Error('Invalid docs.json structure: navigation.groups must be an array');
      }
      
      this.logger.success(`Loaded docs.json with ${jsonData.navigation.groups.length} groups`);
      this.logger.debug('Docs structure', { 
        groupCount: jsonData.navigation.groups.length,
        groups: jsonData.navigation.groups.map(g => g.group || 'Unnamed Group')
      });
      
      return jsonData;
    } catch (error) {
      this.logger.error('Failed to load docs.json', error);
      throw error;
    }
  }

  async processPagePath(pagePath, groupContext = []) {
    try {
      if (this.processedPaths.has(pagePath)) {
        this.logger.warn(`Duplicate page path detected: ${pagePath}`);
        return false;
      }
      this.processedPaths.add(pagePath);

      const filePath = path.join(config.output, `${pagePath}.mdx`);
      
      // Check if file should be excluded
      if (Utils.isExcluded(filePath)) {
        this.logger.warn(`Excluded file: ${pagePath}`);
        return false;
      }
      
      const dirPath = path.dirname(filePath);
      
      // Ensure directory exists (only if it's not the root output directory)
      if (dirPath !== config.output) {
        const created = await Utils.ensureDirectory(dirPath);
        if (created) {
          this.stats.directoriesCreated++;
          this.logger.info(`Created directory: ${path.relative(config.output, dirPath)}`);
        }
      }
      
      // Check if file exists
      if (existsSync(filePath) && !config.force) {
        this.logger.warn(`File already exists (use --force to overwrite): ${pagePath}.mdx`);
        this.stats.filesSkipped++;
        return false;
      }
      
      // Generate content
      const content = await this.generatePageContent(pagePath, groupContext);
      
      // Write file (or simulate in dry run)
      if (config.dryRun) {
        this.logger.info(`[DRY RUN] Would create: ${pagePath}.mdx`);
      } else {
        await fs.writeFile(filePath, content, 'utf8');
        this.logger.success(`Created: ${pagePath}.mdx`);
      }
      
      this.stats.filesCreated++;
      return true;
    } catch (error) {
      this.logger.error(`Failed to process page: ${pagePath}`, error);
      this.stats.errors++;
      return false;
    }
  }

  async generatePageContent(pagePath, groupContext = []) {
    const pageType = Utils.inferPageType(pagePath);
    const template = config.templates[pageType + 'Page'] || config.templates.basicPage;
    
    const title = Utils.generatePageTitle(pagePath, groupContext);
    const description = Utils.generateDescription(pagePath, groupContext);
    
    const frontmatter = {
      ...template.frontmatter,
      title,
      description
    };
    
    if (pageType === 'api') {
      frontmatter.api = `POST https://api.shelther.app/v1/${pagePath.replace('api-reference/', '')}`;
    }
    
    const frontmatterText = Utils.generateFrontmatter(frontmatter);
    const bodyContent = template.content;
    
    return `${frontmatterText}\n# ${title}\n\n${bodyContent}`;
  }

  async processNavigationItem(item, groupContext = []) {
    if (typeof item === 'string') {
      await this.processPagePath(item, groupContext);
    } else if (typeof item === 'object' && item !== null) {
      if (item.group && Array.isArray(item.pages)) {
        this.logger.info(`Processing group: ${item.group}`);
        const newContext = [...groupContext, item.group];
        
        for (const page of item.pages) {
          await this.processNavigationItem(page, newContext);
        }
      } else if (item.pages) {
        this.logger.warn('Found group without name', item);
        for (const page of item.pages) {
          await this.processNavigationItem(page, groupContext);
        }
      } else {
        this.logger.warn('Unknown navigation item structure', item);
      }
    }
  }

  async processNavigation(navigation) {
    this.logger.info('Processing navigation structure...');
    
    for (let i = 0; i < navigation.groups.length; i++) {
      const group = navigation.groups[i];
      
      this.logger.info(`Processing group ${i + 1}/${navigation.groups.length}: ${group.group || 'Unnamed Group'}`);
      
      if (!Array.isArray(group.pages)) {
        this.logger.warn(`Group "${group.group}" has no pages array`);
        continue;
      }
      
      const groupContext = group.group ? [group.group] : [];
      
      for (const page of group.pages) {
        await this.processNavigationItem(page, groupContext);
      }
    }
  }

  async generate() {
    try {
      this.logger.info('Starting Mintlify docs generation...');
      this.logger.info(`Mode: ${config.dryRun ? 'DRY RUN' : 'LIVE'}`);
      this.logger.info(`Output directory: ${config.output} (ROOT DIRECTORY)`);
      
      const docsData = await this.loadDocsJson();
      await this.processNavigation(docsData.navigation);
      
      this.printSummary();
      await this.logger.saveToFile();
      
      this.logger.success('Documentation generation completed!');
      this.logger.info('Files are now in the ROOT directory alongside docs.json');
      
    } catch (error) {
      this.logger.error('Documentation generation failed', error);
      process.exit(1);
    }
  }

  printSummary() {
    this.logger.info('='.repeat(60));
    this.logger.info('GENERATION SUMMARY');
    this.logger.info('='.repeat(60));
    this.logger.info(`Output location: ROOT DIRECTORY (${config.output})`);
    this.logger.info(`Files created: ${this.stats.filesCreated}`);
    this.logger.info(`Directories created: ${this.stats.directoriesCreated}`);
    this.logger.info(`Files skipped: ${this.stats.filesSkipped}`);
    this.logger.info(`Errors: ${this.stats.errors}`);
    this.logger.info(`Unique paths processed: ${this.processedPaths.size}`);
    this.logger.info('='.repeat(60));
  }
}

// ============================================================================
// CLI INTERFACE
// ============================================================================

function printUsage() {
  console.log(`
🛡️  Shelther Mintlify Docs Generator (Root Directory Version)

Usage: node generate-docs-root.js [options]

Options:
  --dry-run     Simulate generation without creating files
  --force       Overwrite existing files
  --verbose     Show detailed output and data
  --help        Show this help message

Examples:
  node generate-docs-root.js                    # Generate docs in root
  node generate-docs-root.js --dry-run          # Preview what would be generated
  node generate-docs-root.js --force --verbose  # Overwrite existing with details

Configuration:
  Input:  ${config.input}
  Output: ${config.output} (ROOT DIRECTORY - CORRECTED!)
  Log:    ${config.logFile}

Note: Files will be created in the ROOT directory alongside docs.json,
      not in a separate 'docs' subdirectory.
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

  const logger = new Logger(config.logFile);
  
  try {
    logger.info('Mintlify Docs Generator Started (ROOT DIRECTORY VERSION)');
    logger.debug('Configuration', config);
    
    const generator = new DocsGenerator(logger);
    await generator.generate();
    
  } catch (error) {
    logger.error('Fatal error during generation', error);
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

if (require.main === module) {
  main();
}

module.exports = { DocsGenerator, Logger, Utils, config };