import * as assert from 'assert';
import * as vscode from 'vscode';
import { suite, test, suiteSetup } from 'mocha';
import { PetManager } from '../../pet/PetManager';

suite('PetManager Integration Test Suite', () => {
    let context: vscode.ExtensionContext;
    let petManager: PetManager;

    suiteSetup(async () => {
        const ext = vscode.extensions.getExtension('Zenithdev.terminal-buddy');
        await ext?.activate();
    });

    test('PetManager should initialize with default state', () => {
        const mockContext = {
            globalState: {
                get: () => undefined,
                update: () => Promise.resolve()
            },
            subscriptions: []
        } as unknown as vscode.ExtensionContext;

        const manager = new PetManager(mockContext);
        const state = manager.getState();
        
        // Since default in package.json is Zenith/Dragon, it starts at Level 10
        assert.strictEqual(state.level, 10);
        assert.strictEqual(state.xp, 4500);
        assert.ok(state.name);
    });

    test('PetManager should gain XP on successful command', () => {
        // Mock a Level 1 state to test leveling and XP gain
        const starterState = {
            type: 'cat',
            name: 'Tester',
            xp: 0,
            level: 1,
            mood: 'neutral',
            errorsFixed: 0,
            lastActiveAt: Date.now()
        };

        const mockContext = {
            globalState: {
                get: () => starterState,
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

        assert.strictEqual(manager.getState().xp, initialXP + 10);
        assert.strictEqual(manager.getState().mood, 'happy');
    });

    test('PetManager should level up', () => {
        // Start at level 1 with 90 XP (threshold for Lv 2 is 100)
        const starterState = {
            type: 'cat',
            name: 'Tester',
            xp: 90,
            level: 1,
            mood: 'neutral',
            errorsFixed: 0,
            lastActiveAt: Date.now()
        };

        const mockContext = {
            globalState: {
                get: () => starterState,
                update: () => Promise.resolve()
            },
            subscriptions: []
        } as unknown as vscode.ExtensionContext;

        const manager = new PetManager(mockContext);
        
        // 10 XP per successful command -> should reach 100 XP and level up
        manager.onCommand({
            id: 'levelup-test',
            cmd: 'ls',
            exitCode: 0,
            status: 'ok',
            cwd: '.',
            project: 'test-project',
            tag: 'other',
            timestamp: Date.now(),
            isAgentRun: false
        });

        assert.strictEqual(manager.getState().level, 2);
    });
});
