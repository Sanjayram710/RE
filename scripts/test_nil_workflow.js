import assert from 'node:assert/strict';
import { handleFunctionalApi } from '../lib/functionalApi.js';
import { db, gstinRepo } from '../lib/db.js';

// Setup mock request and response
function mockReqRes(method, pathname, query = {}, body = null) {
  const req = { method, url: pathname, headers: {} };
  let statusCode = 200;
  let headers = {};
  let data = '';

  const res = {
    writeHead(code, h) {
      statusCode = code;
      headers = h;
    },
    end(payload) {
      data = payload;
    }
  };

  return {
    req,
    res,
    run: async () => {
      await handleFunctionalApi(req, res, pathname, method, query, body);
      return { statusCode, headers, body: data ? JSON.parse(data) : null };
    }
  };
}

async function run() {
  console.log('Testing Nil Verify & Nil File API...');

  // 1. Check with MH branch (has 14 sales, 8 purchases) -> should block Nil filing
  const verifyMh = await mockReqRes('GET', '/api/gst/nil-verify', { period: '102026' }).run();
  console.log('Verify MH result:', verifyMh.body);
  assert.equal(verifyMh.body.eligible, false, 'MH branch has transactions so cannot be eligible for Nil');
  assert.equal(verifyMh.body.hasTransactions, true);
  assert.ok(verifyMh.body.verification.salesCount > 0);
  assert.ok(verifyMh.body.message.includes('Transactions recorded'));

  // 2. Attempting to file Nil for MH branch -> should return 400 error
  const fileMh = await mockReqRes('POST', '/api/gst/nil-file', {}, { period: '102026' }).run();
  console.log('File MH result status:', fileMh.statusCode, fileMh.body);
  assert.equal(fileMh.statusCode, 400);
  assert.equal(fileMh.body.success, false);
  assert.ok(fileMh.body.error.includes('Cannot file Nil Return'));

  // 3. Switch context to an entity with 0 transactions, e.g. KA branch (29AAACB1234F1Z5)
  const kaBranch = gstinRepo.findByGstin('29AAACB1234F1Z5');
  assert.ok(kaBranch, 'KA branch should exist');

  // Set active GSTIN to KA
  const selectKa = await mockReqRes('POST', `/api/gstins/${kaBranch.id}/activate`).run();
  console.log('Select KA result:', selectKa.body);

  // Verify KA branch -> should be eligible for Nil
  const verifyKa = await mockReqRes('GET', '/api/gst/nil-verify', { period: '102026' }).run();
  console.log('Verify KA result:', verifyKa.body);
  assert.equal(verifyKa.body.eligible, true);
  assert.equal(verifyKa.body.hasTransactions, false);
  assert.equal(verifyKa.body.verification.salesCount, 0);
  assert.equal(verifyKa.body.verification.purchasesCount, 0);

  // File Nil for KA branch -> should succeed
  const fileKa = await mockReqRes('POST', '/api/gst/nil-file', {}, { period: '102026', authorisedPerson: 'Rajesh Sharma' }).run();
  console.log('File KA result:', fileKa.body);
  assert.equal(fileKa.statusCode, 200);
  assert.equal(fileKa.body.success, true);
  assert.equal(fileKa.body.isNil, true);
  assert.equal(fileKa.body.isSimulation, true);
  assert.ok(fileKa.body.arn.startsWith('NIL-AA29'));

  // Switch back to MH primary branch
  const mhBranch = gstinRepo.findByGstin('27AAACA1234A1Z5');
  await mockReqRes('POST', `/api/gstins/${mhBranch.id}/activate`).run();

  console.log('✅ ALL NIL WORKFLOW TESTS PASSED!');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
