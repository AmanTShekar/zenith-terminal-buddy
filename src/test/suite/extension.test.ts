import * as assert from 'assert';
import * as vscode from 'vscode';
// Explicit mocha imports removed to allow VS Code test runner to provide globals

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

    test('Extension should be present', () => {
		assert.ok(vscode.extensions.getExtension('Zenithdev.terminal-buddy'));
	});

    test('Extension should activate', async () => {
        const ext = vscode.extensions.getExtension('Zenithdev.terminal-buddy');
        if (ext) {
            await ext.activate();
            assert.strictEqual(ext.isActive, true);
        }
    });

    test('All commands should be registered', async () => {
        const ext = vscode.extensions.getExtension('Zenithdev.terminal-buddy');
        if (ext && !ext.isActive) {
            await ext.activate();
        }
        const commands = await vscode.commands.getCommands(true);
        const expectedCommands = [
            'terminalBuddy.openPanel',
            'terminalBuddy.analyzeTerminal',
            'terminalBuddy.explainError',
            'terminalBuddy.setApiKey',
            'terminalBuddy.clearHistory',
            'terminalBuddy.togglePet',
            'terminalBuddy.runExecutable',
            'terminalBuddy.moveToDirectory'
        ];
        
        for (const cmd of expectedCommands) {
            assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`);
        }
    });

    test('Webview view provider should be available', async () => {
        // This test ensures the side bar view can be opened
        // We trigger the command to show the panel
        try {
            await vscode.commands.executeCommand('terminalBuddy.openPanel');
            assert.ok(true, 'Command terminalBuddy.openPanel should execute');
        } catch (e) {
            assert.fail('Failed to execute terminalBuddy.openPanel: ' + e);
        }
    });
});
