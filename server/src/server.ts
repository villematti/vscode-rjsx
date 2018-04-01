/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as request  from 'request';

import {
	IPCMessageReader, IPCMessageWriter, createConnection, IConnection, TextDocuments, TextDocument,
	Diagnostic, DiagnosticSeverity, InitializeResult, TextDocumentPositionParams, CompletionItem,
	CompletionItemKind, Hover
} from 'vscode-languageserver';

// Create a connection for the server. The connection uses Node's IPC as a transport
let connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments = new TextDocuments();
// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

let serverCompleteItems: CompletionItem[] = [];

// After the server has started the client sends an initialize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilities.
connection.onInitialize((_params): InitializeResult => {
	return {
		capabilities: {
			hoverProvider: true,
			// Tell the client that the server works in FULL text document sync mode
			textDocumentSync: documents.syncKind,
			// Tell the client that the server support code complete
			completionProvider: {
				resolveProvider: true
			}
		}
	}
});

connection.onDidOpenTextDocument((_documentThing) => {
	console.log("Here we are! First...");
	request.post({url:'http://localhost:8080/api/rjsxlanguageserver/oncomplete',
		body: JSON.stringify(_documentThing)}, 
		function fileOpenCallback(err: any, httpResponse: any, body: any) {
			if(err) console.log("The error: ", err);

			try {
				serverCompleteItems = JSON.parse(body);
			} catch (e) {
				return {};
			}
			console.log("Here we are!");
			return true;
		}
	)
})

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
// documents.onDidChangeContent((change) => {
// 		validateTextDocument(change.document);
// });


connection.onDidSaveTextDocument((documentToValidate) => {
	validateTextDocument(documents.get(documentToValidate.textDocument.uri));
})

// The settings interface describe the server relevant settings part
interface Settings {
	rjsxLanguageServer: RJSXSettings;
}

// These are the example settings we defined in the client's package.json
// file
interface RJSXSettings {
	maxNumberOfProblems: number;
}

// hold the maxNumberOfProblems setting
let maxNumberOfProblems: number;
// The settings have changed. Is send on server activation
// as well.
connection.onDidChangeConfiguration((change) => {
	let settings = <Settings>change.settings;
	maxNumberOfProblems = settings.rjsxLanguageServer.maxNumberOfProblems || 100;
	// Revalidate any open text documents
	documents.all().forEach(validateTextDocument);
});

function validateTextDocument(textDocument: TextDocument): void {
	let diagnostics: Diagnostic[] = [];

	let lines = textDocument.getText().split(/\r?\n/g);
	let problems = 0;

	request.post({url:'http://localhost:8080/api/rjsxlanguageserver/onchange',
		body: JSON.stringify({content: textDocument.getText(), uri: textDocument.uri})}, 
		function optionalCallback(err: any, httpResponse: any, body: any) {
			if(err) return httpResponse;
			
			let messages = JSON.parse(body).errors;
			for (var i = 0; i < messages.length && problems < maxNumberOfProblems; i++) {
				problems++;
				
				if(messages[i].length == 0) {
					messages[i].length = lines[i].length - messages[i].character;
				}

				let messageType: DiagnosticSeverity = DiagnosticSeverity.Error;

				switch(messages[i].type) {
					case "warning":
					messageType = DiagnosticSeverity.Warning;
					break;
					case "error":
					messageType = DiagnosticSeverity.Error;
					break;
					case "information":
					messageType = DiagnosticSeverity.Information;
					break;
					case "hint":
					messageType = DiagnosticSeverity.Hint;
					break;
				}

				diagnostics.push({
					severity: messageType,
					range: {
						start: { line: messages[i].line, character: messages[i].character},
						end: { line: messages[i].line, character: messages[i].character + messages[i].length }
					},
					message: messages[i].message,
					source: 'rjsx'
				});
			}

			// Send the computed diagnostics to VSCode.
			connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
	})
}

connection.onDidChangeWatchedFiles((_change) => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
});

connection.onHover((_textDocumentPosition: TextDocumentPositionParams): Hover => {
	let hoveringObject = {
		content: documents.get(_textDocumentPosition.textDocument.uri).getText(),
		uri: _textDocumentPosition.textDocument.uri,
		line: _textDocumentPosition.position.line,
		character: _textDocumentPosition.position.character
	}

	let hover = {
		contents: ""
	}

	return hover;
})

// This handler provides the initial list of the completion items.
connection.onCompletion((_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
	console.log("Raw: ", _textDocumentPosition);
	console.log("Position char: ", _textDocumentPosition.position.character);
	console.log("Position line: ", _textDocumentPosition.position.line);
	console.log("Content: ", documents.get(_textDocumentPosition.textDocument.uri).getText());
	// The pass parameter contains the position of the text document in
	// which code complete got requested. For the example we ignore this
	// info and always provide the same completion items.
	// return [
	// 	{
	// 		label: 'TypeScript',
	// 		kind: CompletionItemKind.Text,
	// 		data: 1
	// 	},
	// 	{
	// 		label: 'JavaScript',
	// 		kind: CompletionItemKind.Text,
	// 		data: 2
	// 	},
	// 	{
	// 		label: 'Joku arvo',
	// 		kind: CompletionItemKind.Class,
	// 		data: 3
	// 	}
	// ]
	return serverCompleteItems;
});

// This handler resolve additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
	
	// console.log(item);
	// if (item.data === 1) {
	// 	item.detail = 'TypeScript details',
	// 		item.documentation = 'TypeScript documentation'
	// } else if (item.data === 2) {
	// 	item.detail = 'JavaScript details',
	// 		item.documentation = 'JavaScript documentation'
	// } else if (item.data === 3) {
	// 	item.detail = "Joku muu arvo"
	// 	item.documentation == "Tällanen dokumentaatio"
	// }
	return item;
});

/*
connection.onDidOpenTextDocument((params) => {
	// A text document got opened in VSCode.
	// params.uri uniquely identifies the document. For documents store on disk this is a file URI.
	// params.text the initial full content of the document.
	connection.console.log(`${params.textDocument.uri} opened.`);
});


connection.onDidChangeTextDocument((params) => {
	// The content of a text document did change in VSCode.
	// params.uri uniquely identifies the document.
	// params.contentChanges describe the content changes to the document.
	connection.console.log(`${params.textDocument.uri} changed: ${JSON.stringify(params.contentChanges)}`);
});

connection.onDidCloseTextDocument((params) => {
	// A text document got closed in VSCode.
	// params.uri uniquely identifies the document.
	connection.console.log(`${params.textDocument.uri} closed.`);
});
*/

// Listen on the connection
connection.listen();
