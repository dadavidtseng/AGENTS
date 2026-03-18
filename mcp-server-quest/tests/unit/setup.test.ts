/**
 * Sample Unit Test
 * 
 * This test verifies that the testing framework is properly configured.
 */

import { describe, it, expect } from 'vitest';
import { createMockQuest, createMockTask, createMockAgent } from '../fixtures/mock-data';

describe('Testing Framework Setup', () => {
  it('should run tests successfully', () => {
    expect(true).toBe(true);
  });

  it('should have access to test utilities', () => {
    expect(createMockQuest).toBeDefined();
    expect(createMockTask).toBeDefined();
    expect(createMockAgent).toBeDefined();
  });

  it('should generate mock quest data', () => {
    const quest = createMockQuest({ name: 'Custom Quest' });
    
    expect(quest).toBeDefined();
    expect(quest.id).toBeDefined();
    expect(quest.name).toBe('Custom Quest');
    expect(quest.status).toBe('draft');
  });

  it('should generate mock task data', () => {
    const task = createMockTask({ name: 'Custom Task' });
    
    expect(task).toBeDefined();
    expect(task.id).toBeDefined();
    expect(task.name).toBe('Custom Task');
    expect(task.status).toBe('pending');
  });

  it('should generate mock agent data', () => {
    const agent = createMockAgent({ name: 'Custom Agent' });
    
    expect(agent).toBeDefined();
    expect(agent.id).toBeDefined();
    expect(agent.name).toBe('Custom Agent');
    expect(agent.type).toBe('ai');
  });
});
