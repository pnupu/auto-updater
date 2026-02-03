// Simple test file
console.log('Running tests...');

// Test 1
if (1 + 1 === 2) {
  console.log('✓ Math works');
} else {
  console.error('✗ Math is broken');
  process.exit(1);
}

// Test 2
if (typeof require !== 'undefined' || typeof import.meta !== 'undefined') {
  console.log('✓ Module system works');
} else {
  console.error('✗ Module system broken');
  process.exit(1);
}

console.log('\nAll tests passed! ✓');
