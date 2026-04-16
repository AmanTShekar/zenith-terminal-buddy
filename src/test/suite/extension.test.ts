import * as assert from 'assert';
import * as vscode from 'vscode';
import { suite, test } from 'mocha';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

    test('Extension should be present', () => {
        const id = 'Zenithdev.zenith-terminal-buddy';
        console.log(`Checking for extension: ${id}`);
        const ext = vscode.extensions.getExtension(id);
        if (!ext) {
            console.log('Available extensions:', vscode.extensions.all.map(e => e.id).filter(id => id.includes('buddy')));
        }
		assert.ok(ext, `Extension ${id} not found`);
	});

    test('Extension should activate', async () => {
        const id = 'Zenithdev.zenith-terminal-buddy';
        console.log(`Activating extension: ${id}`);
        const ext = vscode.extensions.getExtension(id);
        if (ext) {
            await ext.activate();
            console.log(`Is Active: ${ext.isActive}`);
            assert.strictEqual(ext.isActive, true);
        } else {
            assert.fail(`Extension ${id} not found for activation`);
        }
    });

    test('All commands should be registered', async () => {
        const id = 'Zenithdev.zenith-terminal-buddy';
        const ext = vscode.extensions.getExtension(id);
        if (ext && !ext.isActive) {
            await ext.activate();
        }
        const commands = await vscode.commands.getCommands(true);
        const buddyCommands = commands.filter(c => c.startsWith('terminalBuddy.'));
        console.log('Registered Buddy Commands:', buddyCommands);
        
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
