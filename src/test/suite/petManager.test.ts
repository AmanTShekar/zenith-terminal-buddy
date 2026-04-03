import * as assert from 'assert';
import * as vscode from 'vscode';
import { suite, test, suiteSetup } from 'mocha';
import { PetManager } from '../../pet/PetManager';

suite('PetManager Integration Test Suite', () => {
    let context: vscode.ExtensionContext;
    let petManager: PetManager;

    suiteSetup(async () => {
        // In a real VS Code test, we get the context from the extension activation
        const ext = vscode.extensions.getExtension('terminal-buddy.terminal-buddy');
        await ext?.activate();
        // Since we can't easily grab the internal PetManager instance from the extension base, 
        // we'll create a mock context for testing logic if needed, 
        // or just test the public API if we can get a handle.
    });

    test('PetManager should initialize with default state', () => {
        // Mocking ExtensionContext for unit-like testing of PetManager
        const mockContext = {
            globalState: {
                get: () => undefined,
                update: () => Promise.resolve()
            },
            subscriptions: []
        } as unknown as vscode.ExtensionContext;

        const manager = new PetManager(mockContext);
        const state = manager.getState();
        
        assert.strictEqual(state.level, 1);
        assert.strictEqual(state.xp, 0);
        assert.ok(state.name);
    });

    test('PetManager should gain XP on successful command', () => {
        const mockContext = {
            globalState: {
                get: () => undefined,
                update: () => Promise.resolve()
            },
            subscriptions: []
        } as unknown as vscode.ExtensionContext;

        const manager = new PetManager(mockContext);
        const initialXP = manager.getState().xp;
        
        manager.onCommand({
            id: '1',
            cmd: 'ls',
            exitCode: 0,
            status: 'ok',
            cwd: '.',
            project: 'test-project',
            tag: 'other',
            timestamp: Date.now(),
            isAgentRun: false
        });

        assert.strictEqual(manager.getState().xp, initialXP + 5);
        assert.strictEqual(manager.getState().mood, 'happy');
    });

    test('PetManager should level up', () => {
        const mockContext = {
            globalState: {
                get: () => undefined,
                update: () => Promise.resolve()
            },
            subscriptions: []
        } as unknown as vscode.ExtensionContext;

        const manager = new PetManager(mockContext);
        
        // Force XP to just below level 2 (threshold 100)
        for (let i = 0; i < 20; i++) {
            manager.onCommand({
                id: i.toString(),
                cmd: 'ls',
                exitCode: 0,
                status: 'ok',
                cwd: '.',
                project: 'test-project',
                tag: 'other',
                timestamp: Date.now(),
                isAgentRun: false
            });
        }

        assert.strictEqual(manager.getState().level, 2);
    });
});
