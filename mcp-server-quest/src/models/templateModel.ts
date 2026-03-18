/**
 * Template Model - Quest template management and placeholder substitution
 * Supports rapid quest creation from predefined templates
 */

import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { QuestTemplate } from '../types/index.js';
import { config } from '../utils/config.js';

/**
 * Applied template with substituted variables
 */
export interface AppliedTemplate {
  /** Requirements document with variables replaced */
  requirements: string;
  /** Design document with variables replaced */
  design: string;
  /** Task templates with variables replaced */
  tasks: any[];
}

/**
 * Template Model - Handles quest template operations
 */
export class TemplateModel {
  /** Path to templates directory */
  private static get templatesDir(): string {
    return join(config.questDataDir, 'templates');
  }

  /**
   * Load a quest template from file system
   * 
   * @param templateName - Name of template directory
   * @returns Quest template with requirements, design, and tasks
   * @throws Error if template not found or incomplete
   * 
   * @example
   * const template = await TemplateModel.loadTemplate('code-feature');
   */
  static async loadTemplate(templateName: string): Promise<QuestTemplate> {
    const templateDir = join(TemplateModel.templatesDir, templateName);

    try {
      // Load all template files
      const [requirementsTemplate, designTemplate, tasksTemplateJson] = await Promise.all([
        readFile(join(templateDir, 'requirements-template.md'), 'utf-8'),
        readFile(join(templateDir, 'design-template.md'), 'utf-8'),
        readFile(join(templateDir, 'tasks-template.json'), 'utf-8'),
      ]);

      // Parse tasks template
      const tasksTemplate = JSON.parse(tasksTemplateJson);

      return {
        name: templateName,
        requirementsTemplate,
        designTemplate,
        tasksTemplate,
      };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error(`Template not found: ${templateName}`);
      }
      throw error;
    }
  }

  /**
   * Apply template with variable substitution
   * Replaces {{VARIABLE}} placeholders with provided values
   * 
   * @param template - Quest template to apply
   * @param variables - Variables to substitute (e.g., {FEATURE_NAME: "User Auth"})
   * @returns Applied template with all placeholders replaced
   * 
   * @example
   * const applied = TemplateModel.applyTemplate(template, {
   *   FEATURE_NAME: "User Authentication",
   *   TECH_STACK: "TypeScript + React"
   * });
   */
  static applyTemplate(
    template: QuestTemplate,
    variables: Record<string, string>
  ): AppliedTemplate {
    // Helper function to replace placeholders
    const replacePlaceholders = (text: string): string => {
      let result = text;
      for (const [key, value] of Object.entries(variables)) {
        const placeholder = `{{${key}}}`;
        result = result.split(placeholder).join(value);
      }
      return result;
    };

    // Apply to requirements and design
    const requirements = replacePlaceholders(template.requirementsTemplate);
    const design = replacePlaceholders(template.designTemplate);

    // Apply to tasks (handle JSON with nested placeholders)
    const tasksJson = JSON.stringify(template.tasksTemplate);
    const tasksJsonReplaced = replacePlaceholders(tasksJson);
    const tasks = JSON.parse(tasksJsonReplaced);

    return {
      requirements,
      design,
      tasks,
    };
  }

  /**
   * List all available quest templates
   * 
   * @returns Array of template names
   * 
   * @example
   * const templates = await TemplateModel.listTemplates();
   * // ['art-project', 'code-feature', 'design-system']
   */
  static async listTemplates(): Promise<string[]> {
    try {
      const entries = await readdir(TemplateModel.templatesDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        // Templates directory doesn't exist yet
        return [];
      }
      throw error;
    }
  }

  /**
   * Initialize built-in quest templates
   * Creates default templates if they don't already exist
   * Safe to call multiple times (won't overwrite existing templates)
   * 
   * @example
   * await TemplateModel.initBuiltInTemplates();
   */
  static async initBuiltInTemplates(): Promise<void> {
    // Ensure templates directory exists
    await mkdir(TemplateModel.templatesDir, { recursive: true });

    // Get existing templates
    const existing = await TemplateModel.listTemplates();

    // Art Project Template
    if (!existing.includes('art-project')) {
      const artProjectDir = join(TemplateModel.templatesDir, 'art-project');
      await mkdir(artProjectDir, { recursive: true });

      await writeFile(
        join(artProjectDir, 'requirements-template.md'),
        `# {{PROJECT_NAME}} - Requirements

## Project Overview
Create {{PROJECT_NAME}} with the following specifications:
- Medium: {{MEDIUM}}
- Style: {{STYLE}}
- Dimensions: {{DIMENSIONS}}

## Deliverables
1. Final artwork in high resolution
2. Source files (editable format)
3. Reference materials and sketches
`,
        'utf-8'
      );

      await writeFile(
        join(artProjectDir, 'design-template.md'),
        `# {{PROJECT_NAME}} - Design Specification

## Artistic Direction
- Primary style: {{STYLE}}
- Color palette: {{COLOR_PALETTE}}
- Reference inspirations: {{REFERENCES}}

## Technical Requirements
- Medium: {{MEDIUM}}
- Dimensions: {{DIMENSIONS}}
- File format: {{FILE_FORMAT}}
`,
        'utf-8'
      );

      await writeFile(
        join(artProjectDir, 'tasks-template.json'),
        JSON.stringify([
          {
            name: 'Create initial sketches for {{PROJECT_NAME}}',
            description: 'Develop concept sketches and composition studies',
          },
          {
            name: 'Refine artwork based on feedback',
            description: 'Iterate on design based on approval comments',
          },
          {
            name: 'Deliver final artwork',
            description: 'Export final files in {{FILE_FORMAT}} format',
          },
        ], null, 2),
        'utf-8'
      );
    }

    // Code Feature Template
    if (!existing.includes('code-feature')) {
      const codeFeatureDir = join(TemplateModel.templatesDir, 'code-feature');
      await mkdir(codeFeatureDir, { recursive: true });

      await writeFile(
        join(codeFeatureDir, 'requirements-template.md'),
        `# {{FEATURE_NAME}} - Requirements

## Feature Overview
Implement {{FEATURE_NAME}} using {{TECH_STACK}}.

## Functional Requirements
1. {{REQUIREMENT_1}}
2. {{REQUIREMENT_2}}
3. {{REQUIREMENT_3}}

## Non-Functional Requirements
- Performance: {{PERFORMANCE_TARGET}}
- Security: {{SECURITY_REQUIREMENTS}}
`,
        'utf-8'
      );

      await writeFile(
        join(codeFeatureDir, 'design-template.md'),
        `# {{FEATURE_NAME}} - Technical Design

## Architecture
- Tech Stack: {{TECH_STACK}}
- Components: {{COMPONENTS}}
- Data Flow: {{DATA_FLOW}}

## API Design
- Endpoints: {{API_ENDPOINTS}}
- Authentication: {{AUTH_METHOD}}

## Database Schema
{{DATABASE_SCHEMA}}
`,
        'utf-8'
      );

      await writeFile(
        join(codeFeatureDir, 'tasks-template.json'),
        JSON.stringify([
          {
            name: 'Setup {{FEATURE_NAME}} project structure',
            description: 'Initialize project with {{TECH_STACK}}',
          },
          {
            name: 'Implement core {{FEATURE_NAME}} logic',
            description: 'Build main feature functionality',
          },
          {
            name: 'Add tests for {{FEATURE_NAME}}',
            description: 'Write unit and integration tests',
          },
          {
            name: 'Deploy {{FEATURE_NAME}} to production',
            description: 'Deploy and verify in production environment',
          },
        ], null, 2),
        'utf-8'
      );
    }

    // Design System Template
    if (!existing.includes('design-system')) {
      const designSystemDir = join(TemplateModel.templatesDir, 'design-system');
      await mkdir(designSystemDir, { recursive: true });

      await writeFile(
        join(designSystemDir, 'requirements-template.md'),
        `# {{SYSTEM_NAME}} Design System - Requirements

## Overview
Create a comprehensive design system for {{SYSTEM_NAME}}.

## Components
- {{COMPONENT_LIST}}

## Design Tokens
- Colors: {{COLOR_TOKENS}}
- Typography: {{TYPOGRAPHY_SCALE}}
- Spacing: {{SPACING_SCALE}}
`,
        'utf-8'
      );

      await writeFile(
        join(designSystemDir, 'design-template.md'),
        `# {{SYSTEM_NAME}} Design System - Specification

## Visual Language
- Brand colors: {{BRAND_COLORS}}
- Typography: {{FONT_FAMILY}}
- Grid system: {{GRID_SYSTEM}}

## Component Library
{{COMPONENT_SPECS}}

## Usage Guidelines
{{USAGE_GUIDELINES}}
`,
        'utf-8'
      );

      await writeFile(
        join(designSystemDir, 'tasks-template.json'),
        JSON.stringify([
          {
            name: 'Define {{SYSTEM_NAME}} design tokens',
            description: 'Establish colors, typography, and spacing scales',
          },
          {
            name: 'Create component library for {{SYSTEM_NAME}}',
            description: 'Build reusable UI components',
          },
          {
            name: 'Document {{SYSTEM_NAME}} usage guidelines',
            description: 'Write comprehensive documentation',
          },
        ], null, 2),
        'utf-8'
      );
    }
  }
}
