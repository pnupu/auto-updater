# Simple Dependencies Example

This is a minimal example project for testing the devpost-autoupgrader.

## Intentionally Outdated Packages

- `chalk`: 4.0.0 (current: 5.3.0)
- `commander`: 8.0.0 (current: 12.1.0)
- `typescript`: 4.5.0 (current: 5.7.2)

## Testing

From this directory:

```bash
# Initialize
npm install

# Run tests
npm test

# Run devpost-autoupgrader
cd ..
devpost-upgrade
```

## Expected Behavior

The auto-upgrader should:
1. Detect 3 outdated packages
2. Group them appropriately
3. Update package.json
4. Run npm install
5. Run build (echo command - always succeeds)
6. Run tests (simple test - always succeeds)
7. Create git commit
