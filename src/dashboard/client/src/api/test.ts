/**
 * Simple API client test
 */

import { apiClient } from './client';

// Test REST endpoints
async function testApiClient() {
  try {
    console.log('=== Testing API Client ===');
    
    // Test health check
    console.log('\n1. Testing health check...');
    const health = await apiClient.healthCheck();
    console.log('✓ Health check:', health);
    
    // Test get quests
    console.log('\n2. Testing get quests...');
    const quests = await apiClient.getQuests();
    console.log('✓ Quests:', quests);
    
    // Test get agents
    console.log('\n3. Testing get agents...');
    const agents = await apiClient.getAgents();
    console.log('✓ Agents:', agents);
    
    // Test WebSocket connection
    console.log('\n4. Testing WebSocket...');
    apiClient.connect();
    
    // Subscribe to quest events
    apiClient.on('quest_created', (data) => {
      console.log('✓ Received quest_created event:', data);
    });
    
    apiClient.on('quest_updated', (data) => {
      console.log('✓ Received quest_updated event:', data);
    });
    
    console.log('\n=== All tests completed ===');
  } catch (error) {
    console.error('✗ Test failed:', error);
  }
}

// Run tests if this file is executed directly
if (import.meta.url === new URL(import.meta.url, import.meta.url).href) {
  testApiClient();
}
