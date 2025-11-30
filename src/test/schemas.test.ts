/**
 * Schema Validation Tests
 * =======================
 *
 * This file demonstrates how to test Zod schemas for your KĀDI agent tools.
 *
 * Testing Strategies:
 * 1. Positive tests - Valid inputs pass validation
 * 2. Negative tests - Invalid inputs throw errors
 * 3. Type inference - Ensure types are correctly inferred
 * 4. Edge cases - Test boundary conditions
 *
 * TODO: Replace these example tests with tests for your agent's schemas
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ============================================================================
// Example Schema Tests (Replace with your schemas)
// ============================================================================

describe('Tool Input Schemas', () => {
  describe('format_text schema', () => {
    const formatTextInputSchema = z.object({
      text: z.string().describe('Text to format'),
      style: z.enum(['uppercase', 'lowercase', 'capitalize', 'title']).describe('Formatting style')
    });

    it('should accept valid input', () => {
      const validInput = {
        text: 'hello world',
        style: 'uppercase' as const
      };

      const result = formatTextInputSchema.parse(validInput);
      expect(result).toEqual(validInput);
    });

    it('should reject missing text field', () => {
      const invalidInput = {
        style: 'uppercase'
      };

      expect(() => {
        formatTextInputSchema.parse(invalidInput);
      }).toThrow();
    });

    it('should reject invalid style enum', () => {
      const invalidInput = {
        text: 'hello',
        style: 'invalid-style'
      };

      expect(() => {
        formatTextInputSchema.parse(invalidInput);
      }).toThrow();
    });

    it('should reject non-string text', () => {
      const invalidInput = {
        text: 123,
        style: 'uppercase'
      };

      expect(() => {
        formatTextInputSchema.parse(invalidInput);
      }).toThrow();
    });
  });

  describe('validate_json schema', () => {
    const validateJsonInputSchema = z.object({
      json_string: z.string().describe('JSON string to validate')
    });

    it('should accept valid JSON string', () => {
      const validInput = {
        json_string: '{"name": "Alice", "age": 30}'
      };

      const result = validateJsonInputSchema.parse(validInput);
      expect(result).toEqual(validInput);
    });

    it('should accept invalid JSON string (schema only validates type, not JSON validity)', () => {
      const input = {
        json_string: '{invalid json}'
      };

      // Schema validation passes (it's a string)
      // JSON validation happens in tool handler
      const result = validateJsonInputSchema.parse(input);
      expect(result).toEqual(input);
    });

    it('should reject non-string input', () => {
      const invalidInput = {
        json_string: { name: 'Alice' }
      };

      expect(() => {
        validateJsonInputSchema.parse(invalidInput);
      }).toThrow();
    });
  });

  describe('count_words schema', () => {
    const countWordsInputSchema = z.object({
      text: z.string().describe('Text to analyze')
    });

    it('should accept empty string', () => {
      const input = { text: '' };
      const result = countWordsInputSchema.parse(input);
      expect(result).toEqual(input);
    });

    it('should accept multiline text', () => {
      const input = { text: 'line 1\nline 2\nline 3' };
      const result = countWordsInputSchema.parse(input);
      expect(result).toEqual(input);
    });

    it('should accept very long text', () => {
      const longText = 'word '.repeat(10000);
      const input = { text: longText };
      const result = countWordsInputSchema.parse(input);
      expect(result).toEqual(input);
    });
  });
});

describe('Tool Output Schemas', () => {
  describe('format_text output schema', () => {
    const formatTextOutputSchema = z.object({
      result: z.string().describe('Formatted text'),
      original_length: z.number().describe('Length of original text'),
      formatted_length: z.number().describe('Length of formatted text')
    });

    it('should accept valid output', () => {
      const validOutput = {
        result: 'HELLO WORLD',
        original_length: 11,
        formatted_length: 11
      };

      const result = formatTextOutputSchema.parse(validOutput);
      expect(result).toEqual(validOutput);
    });

    it('should reject missing fields', () => {
      const invalidOutput = {
        result: 'HELLO WORLD'
        // Missing length fields
      };

      expect(() => {
        formatTextOutputSchema.parse(invalidOutput);
      }).toThrow();
    });

    it('should reject non-number length values', () => {
      const invalidOutput = {
        result: 'HELLO',
        original_length: '5',
        formatted_length: '5'
      };

      expect(() => {
        formatTextOutputSchema.parse(invalidOutput);
      }).toThrow();
    });
  });

  describe('validate_json output schema', () => {
    const validateJsonOutputSchema = z.object({
      valid: z.boolean().describe('Whether JSON is valid'),
      parsed: z.any().optional().describe('Parsed JSON if valid'),
      error: z.string().optional().describe('Error message if invalid')
    });

    it('should accept success output', () => {
      const validOutput = {
        valid: true,
        parsed: { name: 'Alice', age: 30 }
      };

      const result = validateJsonOutputSchema.parse(validOutput);
      expect(result).toEqual(validOutput);
    });

    it('should accept error output', () => {
      const errorOutput = {
        valid: false,
        error: 'Unexpected token'
      };

      const result = validateJsonOutputSchema.parse(errorOutput);
      expect(result).toEqual(errorOutput);
    });

    it('should allow parsed to be any type', () => {
      const outputs = [
        { valid: true, parsed: 'string' },
        { valid: true, parsed: 123 },
        { valid: true, parsed: [1, 2, 3] },
        { valid: true, parsed: { nested: { object: true } } }
      ];

      outputs.forEach(output => {
        const result = validateJsonOutputSchema.parse(output);
        expect(result).toEqual(output);
      });
    });
  });
});

// ============================================================================
// Type Inference Tests
// ============================================================================

describe('Type Inference from Schemas', () => {
  it('should correctly infer TypeScript types', () => {
    const schema = z.object({
      text: z.string(),
      count: z.number(),
      optional: z.boolean().optional()
    });

    type InferredType = z.infer<typeof schema>;

    // Type assertion test (compile-time check)
    const validData: InferredType = {
      text: 'hello',
      count: 5
      // optional field is indeed optional
    };

    const result = schema.parse(validData);
    expect(result).toEqual(validData);
  });

  it('should infer enum types correctly', () => {
    const schema = z.object({
      style: z.enum(['uppercase', 'lowercase', 'capitalize'])
    });

    type InferredType = z.infer<typeof schema>;

    // This should compile (valid enum value)
    const valid: InferredType = { style: 'uppercase' };
    expect(schema.parse(valid)).toEqual(valid);

    // This would fail at compile-time (uncomment to test):
    // const invalid: InferredType = { style: 'invalid' };
  });

  it('should handle nested object types', () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        age: z.number()
      }),
      metadata: z.object({
        timestamp: z.string(),
        source: z.string()
      })
    });

    type InferredType = z.infer<typeof schema>;

    const data: InferredType = {
      user: { name: 'Alice', age: 30 },
      metadata: { timestamp: '2025-01-01', source: 'agent' }
    };

    const result = schema.parse(data);
    expect(result).toEqual(data);
  });
});

// ============================================================================
// Edge Case Tests
// ============================================================================

describe('Edge Cases', () => {
  describe('String boundaries', () => {
    const schema = z.object({ text: z.string() });

    it('should handle empty strings', () => {
      expect(schema.parse({ text: '' })).toEqual({ text: '' });
    });

    it('should handle very long strings', () => {
      const longText = 'a'.repeat(1000000);
      expect(schema.parse({ text: longText })).toEqual({ text: longText });
    });

    it('should handle unicode characters', () => {
      const unicode = '你好世界 🌍 emoji';
      expect(schema.parse({ text: unicode })).toEqual({ text: unicode });
    });

    it('should handle special characters', () => {
      const special = '\\n\\t\\r\\"\\\'';
      expect(schema.parse({ text: special })).toEqual({ text: special });
    });
  });

  describe('Number boundaries', () => {
    const schema = z.object({ num: z.number() });

    it('should handle zero', () => {
      expect(schema.parse({ num: 0 })).toEqual({ num: 0 });
    });

    it('should handle negative numbers', () => {
      expect(schema.parse({ num: -100 })).toEqual({ num: -100 });
    });

    it('should handle decimals', () => {
      expect(schema.parse({ num: 3.14159 })).toEqual({ num: 3.14159 });
    });

    it('should handle very large numbers', () => {
      expect(schema.parse({ num: Number.MAX_SAFE_INTEGER })).toEqual({ num: Number.MAX_SAFE_INTEGER });
    });

    it('should reject NaN', () => {
      expect(() => schema.parse({ num: NaN })).toThrow();
    });

    it('should accept Infinity by default', () => {
      // Zod accepts Infinity unless explicitly constrained with .finite()
      expect(schema.parse({ num: Infinity })).toEqual({ num: Infinity });
    });
  });
});

// ============================================================================
// Template for Your Own Tests
// ============================================================================

describe('YOUR TOOL NAME schema tests', () => {
  // TODO: Define your schema here
  // @ts-expect-error - Template schema not used yet
  const yourToolInputSchema = z.object({
    // your_param: z.string().describe('Description')
  });

  describe('Input validation', () => {
    it('should accept valid input', () => {
      // TODO: Test valid inputs
    });

    it('should reject invalid input', () => {
      // TODO: Test invalid inputs
    });

    it('should handle edge cases', () => {
      // TODO: Test boundary conditions
    });
  });

  describe('Output validation', () => {
    it('should produce valid output structure', () => {
      // TODO: Test output schema
    });
  });

  describe('Type inference', () => {
    it('should infer correct TypeScript types', () => {
      // TODO: Test type inference
    });
  });
});
