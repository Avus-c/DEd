import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

function completionFunc(searchContext: string, searchInput: string): vscode.QuickPickItem[] {
	const items: vscode.QuickPickItem[] = [];

	searchInput = path.normalize(searchInput);
	const searchPath: string = !path.isAbsolute(searchInput) ? path.join(searchContext, searchInput) : searchInput;

	if (searchInput === "..") {
		items.push({
			label: "..",
			description: `Move up: ${searchPath}`
		});
	}

	let searchDir: string = path.dirname(searchPath);
	if (!fs.existsSync(searchPath)) {
		items.push({
			label: searchInput,
			description: `Create File`,
		});
	} else if (fs.statSync(searchPath).isDirectory()) {
		searchDir = searchPath;

		//* If input is an existing directory, show option to open that directory.
		items.push({
			label: searchDir,
			description: `Open Directory`,
		});
	}

	const dirContents = fs.readdirSync(searchDir);
	for (let i = 0; i < dirContents.length; i++) {
		const element = dirContents[i];
		const elementPath = path.join(searchDir, element);
		/*
		 * Not using the detail field to keep the list condensed
		 */
		if (fs.statSync(elementPath).isDirectory()) {
			items.push({
				label: `${elementPath}`,
				description: `Open Directory`
			});
		} else {
			items.push({
				label: `${elementPath}`,
				description: `Open File`
			});
		}
	}

	return items;
}

export async function autocompletedInputBox(placeholder: string, searchPathAbsolute: string) {

	let presentSearchPathAbsolute = `${path.normalize(searchPathAbsolute)}`;

	const quickPick = vscode.window.createQuickPick();
	quickPick.placeholder = placeholder;
	quickPick.items = completionFunc(presentSearchPathAbsolute, ""); // on start show present directory items
	quickPick.title = `ded-Search: ${presentSearchPathAbsolute}`;

	const disposables: vscode.Disposable[] = [];
	let result = quickPick.value;

	const makeTask = () => new Promise<void>(resolve => {
		disposables.push(
			quickPick.onDidChangeValue(() => {
				quickPick.items = completionFunc(presentSearchPathAbsolute, quickPick.value);
			}),
			quickPick.onDidAccept(() => {
				if (quickPick.selectedItems.length === 0 || quickPick.selectedItems[0].label === quickPick.value) {
					result = quickPick.value;
					if (!path.isAbsolute(result)) {
						result = path.join(presentSearchPathAbsolute, result);
					}
					quickPick.hide();
					resolve();
				} else {
					quickPick.value = quickPick.selectedItems[0].label;
					presentSearchPathAbsolute = quickPick.value;
					quickPick.title = `ded-Search: ${path.normalize(presentSearchPathAbsolute)}`;
				}
			}),
			quickPick.onDidHide(() => {
				quickPick.dispose();
				result = "";
				resolve();

			}),
		);
		quickPick.show();
	});
	try {
		await makeTask();
	}
	finally {
		disposables.forEach(d => d.dispose());
	}
	return result;
}
