#!/usr/bin/env node

/**
 * Quick test script to verify Gemini API connection
 */

import { config } from 'dotenv';
import { createGeminiClient } from './dist/index.js';

// Load environment variables
config();

async function testGemini() {
  console.log('Testing Gemini API connection...\n');

  try {
    const client = createGeminiClient();
    console.log('✓ Gemini client created successfully');

    // Test a simple prompt
    console.log('\nTesting basic generation...');
    const response = await client.generateText(
      'Say "Hello from Gemini!" and confirm you are working.'
    );

    console.log('\n✓ Response received:');
    console.log(response);

    // Test JSON generation
    console.log('\n\nTesting JSON generation...');
    const jsonResponse = await client.generateJSON(
      'Return a JSON object with keys: status (string), working (boolean), message (string). Set working to true.',
      'You are a helpful assistant that returns valid JSON.'
    );

    console.log('\n✓ JSON Response:');
    console.log(JSON.stringify(jsonResponse, null, 2));

    console.log('\n\n✅ All tests passed! Gemini API is working correctly.');
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\nMake sure:');
    console.error('1. You have a valid GEMINI_API_KEY in your .env file');
    console.error('2. The API key is active at https://aistudio.google.com/app/apikey');
    process.exit(1);
  }
}

testGemini();
