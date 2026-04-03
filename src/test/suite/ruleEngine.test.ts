import * as assert from 'assert';
import { suite, test } from 'mocha';
import { RuleEngine } from '../../core/RuleEngine';

suite('RuleEngine Unit Test Suite', () => {
    const engine = new RuleEngine();

    test('Should detect npm missing script error', async () => {
        const cmd = 'npm run start';
        const output = 'npm ERR! missing script: start';
        const exitCode = 1;
        
        const result = await engine.check(cmd, output, exitCode);
        assert.ok(result);
        assert.strictEqual(result?.summary, "The npm script you tried to run doesn't exist.");
    });

    test('Should detect EADDRINUSE error', async () => {
        const cmd = 'npm start';
        const output = 'Error: listen EADDRINUSE: address already in use :::3000';
        const exitCode = 1;
        
        const result = await engine.check(cmd, output, exitCode);
        assert.ok(result);
        assert.strictEqual(result?.summary, 'Port 3000 is already in use by another process.');
    });

    test('Should detect typo in command (did-you-mean)', async () => {
        const cmd = 'nmp install';
        const output = 'nmp: command not found';
        const exitCode = 127;
        
        const result = await engine.check(cmd, output, exitCode);
        assert.ok(result);
        assert.strictEqual(result?.summary, 'Typo detected! Did you mean `npm`?');
    });

    test('Should detect python missing module', async () => {
        const cmd = 'python script.py';
        const output = "ModuleNotFoundError: No module named 'requests'";
        const exitCode = 1;
        
        const result = await engine.check(cmd, output, exitCode);
        assert.ok(result);
        assert.strictEqual(result?.summary, 'Python module "requests" is not installed.');
    });

    test('Should return null for successful commands', async () => {
        const cmd = 'ls';
        const output = 'file1.txt';
        const exitCode = 0;
        
        const result = await engine.check(cmd, output, exitCode);
        assert.strictEqual(result, null);
    });
});
