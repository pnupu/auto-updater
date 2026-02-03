# Testing Guide - AI Features

## Step 1: Get Your Gemini API Key

1. Visit: https://aistudio.google.com/app/apikey
2. Sign in with your Google account
3. Click **"Get API Key"** or **"Create API Key"**
4. Copy the generated key

**Note**: Use a Gemini 3 model for this project (see `.env` below).

## Step 2: Configure Environment

Create or edit `.env` file in the project root:

```bash
GEMINI_API_KEY=your_actual_api_key_here
GEMINI_MODEL=gemini-3-pro-preview
DEBUG=false
```

**Important**: Replace `your_actual_api_key_here` with your actual API key!

## Step 3: Test Gemini Connection

```bash
# Run the test script
node test-ai.js
```

**Expected Output**:
```
Testing Gemini API connection...

✓ Gemini client created successfully

Testing basic generation...

✓ Response received:
Hello from Gemini! ...

Testing JSON generation...

✓ JSON Response:
{
  "status": "ok",
  "working": true,
  "message": "..."
}

✅ All tests passed! Gemini API is working correctly.
```

## Step 4: Test AI-Powered Grouping

Test intelligent package grouping:

```bash
cd examples/simple-deps
../../dist/cli.js --dry-run
```

**What to Look For**:
- ✓ "Analyzing package relationships with AI..."
- Intelligent grouping with reasoning (not "AI grouping not available")
- Groups should make sense (e.g., related packages together)

## Step 5: Test Full Workflow (Safe)

Since simple-deps has no breaking changes, it should upgrade smoothly:

```bash
# Initialize git repo (required for commits)
cd examples/simple-deps
git init
git add .
git commit -m "Initial commit"

# Run the full workflow
../../dist/cli.js
```

**Expected Flow**:
1. ✓ Analyze packages
2. ✓ AI groups packages intelligently
3. ✓ Updates package.json
4. ✓ Runs npm install
5. ✓ Runs tests (should pass - no breaking changes)
6. ✓ Creates git commit

## Step 6: Test AI Fixing (Advanced)

To test the AI fixing capabilities, we need a project with actual breaking changes. Options:

### Option A: Create React 17→18 Example
React 18 has breaking changes (createRoot API) - perfect for testing!

### Option B: Manually Break simple-deps
1. Update packages
2. Manually introduce a breaking change
3. Run the tool
4. Watch it fix the issue!

## Troubleshooting

### "GEMINI_API_KEY is required"
- Check your `.env` file exists in the root directory
- Verify the key is on a line like: `GEMINI_API_KEY=your_key`
- No quotes needed around the key

### "Failed to get response from Gemini"
- Check your API key is valid at https://aistudio.google.com/app/apikey
- You might be rate-limited - wait a few seconds and retry
- Check you have quota remaining (free tier has limits)

### "AI grouping not available"
- This means the Gemini client failed to initialize
- Check the error messages above in the output
- Verify your `.env` file is in the correct location

## Next Steps

Once the AI features are working:
1. Create a React 17→18 example with real breaking changes
2. Test the full AI-powered fixing workflow
3. Record a demo video showing the tool in action!

## API Usage Tips

**For Testing**:
- Use `--dry-run` to avoid consuming quota
- The tool has exponential backoff for rate limits
- Each package group uses ~2-4 API calls (grouping + fixing if needed)

**Quota**: Check your current limits in AI Studio for the latest Gemini 3 quotas.
