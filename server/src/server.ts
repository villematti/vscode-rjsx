/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as request  from 'request';

import {
	IPCMessageReader, IPCMessageWriter, createConnection, IConnection, TextDocuments, TextDocument, Definition, Location, Range, Position,
	Diagnostic, DiagnosticSeverity, InitializeResult, TextDocumentPositionParams, CompletionItem, Hover
} from 'vscode-languageserver';
import { start } from 'repl';

// Create a connection for the server. The connection uses Node's IPC as a transport
let connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments = new TextDocuments();
// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

let serverCompleteItems: CompletionItem[] = [];
let onCompleteApi = "http://localhost:8080/skillsmodule/api/rjsxlanguageserver/getallcompleteitems/?uris=";
let errorCheckApi = "http://localhost:8080/roboceo/api/rjsxlanguageserver/geterrors/?uri=";

// After the server has started the client sends an initialize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilities.
connection.onInitialize((_params): InitializeResult => {
	return {
		capabilities: {
			// hoverProvider: true,
			// Tell the client that the server works in FULL text document sync mode
			textDocumentSync: documents.syncKind,
			// Tell the client that the server support code complete
			completionProvider: {
				resolveProvider: true,
				triggerCharacters: ['.']
			},
			hoverProvider: true,
			documentFormattingProvider: true,
			definitionProvider: true
		}
	}
});

connection.onDidChangeConfiguration(() => {
	documents.all().forEach(onCompleteApiCall);
	documents.all().forEach(rjsxValidate);
})

documents.onDidChangeContent((change) => {
	rjsxValidate(change.document);
	onCompleteApiCall(change.document);
})

function onCompleteApiCall(_someDocument: TextDocument) {
	let _documentUri = _someDocument.uri;
	
	let fileArray = _documentUri.split("/");
	let moduleName = fileArray[fileArray.indexOf("js") - 1];

	let urlToParse = "";

	if(fileArray.indexOf("frontendcommons") === -1) {
		urlToParse += ";../" + moduleName + "/js";
	}

	request.get({url: onCompleteApi + "../frontendcommons/js" + urlToParse}, 
		function fileOpenCallback(err: any, httpResponse: any, body: any) {
			if(err) console.log("The error: ", err);

			try {
				serverCompleteItems = JSON.parse(body);
			} catch (e) {
				return {};
			}
			return true;
		}
	)
}

connection.onDidSaveTextDocument((documentToValidate) => {
	// validateTextDocument(documentToValidate: TextDocument);
	// onCompleteApiCall(documents.get(documentToValidate.textDocument.uri));
})

function rjsxValidate(_textDocument: TextDocument): void {
	let fileUri = _textDocument.uri;
	let diagnostics: Diagnostic[] = [];
	let fileArray = fileUri.split("/");

	let moduleName = fileArray[fileArray.indexOf("js") - 1];
	
	let urlToParse = "";

	if(fileArray.indexOf("frontendcommons") === -1) {

		// If there is a js-component outside frontendcommons, make sure it gets properly included
		if(fileUri.indexOf(".js-components") !== -1) {
			let componentArray = fileUri.split(".js-components");
			let componentArrayModule = componentArray[0].split("/");
			urlToParse += "../" + moduleName + "/js/" + componentArrayModule[componentArrayModule.length - 1] + ".js-components/" + fileArray[fileArray.length - 1]
		} else {
			urlToParse += "../" + moduleName + "/js/" + fileArray[fileArray.length - 1];
		}
	} else {
		let componentUri = fileUri.split("frontendcommons");
		urlToParse += "../frontendcommons" + componentUri[1];
	}

	// console.log("Parsed thing: ", urlToParse);

	// Create call to validation service through API
	request.get({url:errorCheckApi + urlToParse}, 
		function optionalCallback(err: any, httpResponse: any, body: any) {
			if(err) return httpResponse;
			
			let messages = JSON.parse(body).errors;
			messages.map((mes: any) => {
				let messageType: DiagnosticSeverity;
				switch(mes.type) {
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

				// Init values
				let range = {
					start: { line: 0, character: 0}, //line: messages[i].line, character: messages[i].character},
					end: { line: 0, character: 0},// line: messages[i].line, character: messages[i].character + messages[i].length }
				}

				// Updated for endlines
				if(mes.line !== undefined) {
					range = {
						start: { line: mes.line, character: mes.character},
						end: { line: mes.endLine, character: mes.endCharacter},
					}
				}

				diagnostics.push({
					severity: messageType,
					range: range,
					message: mes.message, // messages[i].message,
					source: 'rjsx'
				});

			})

			// Send the computed diagnostics to VSCode.
			connection.sendDiagnostics({ uri: fileUri, diagnostics });
	})
}

connection.onDefinition((_location): Definition => {
	let definition: Definition;

	// Compile the ContentObject
	let content: ContentObject = {
		content: documents.get(_location.textDocument.uri).getText(),
		line: _location.position.line,
		char: _location.position.character
	}

	// Check what word we are hovering over
	let validateContent = checkWhatWord(content).toLocaleLowerCase()

	// Map through onComplete items and check if hovered value maches anything
	serverCompleteItems.map((item) => {

		if(item.label.toLocaleLowerCase() === validateContent) {
			
			if(item.data !== undefined) {
				let range: Range;
				let location: Location;
				let startPosition: Position;
				let endPosition: Position;
				if(item.data.uri) {

					if(item.data.range) {
						startPosition = Position.create(item.data.range.startPosition.line, item.data.range.startPosition.char);
						endPosition = Position.create(item.data.range.endPosition.line, item.data.range.endPosition.char);

						range = Range.create(startPosition, endPosition);
						location = Location.create(item.data.uri, range);
	
						definition = location;
					}
				}
			}
		}
	})

	return definition;
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

// When finding out a spesific work from line, this is interface is needed
interface ContentObject {
	content: string,
	line: number,
	char: number
}

// hold the maxNumberOfProblems setting
let maxNumberOfProblems: number;

connection.onDidChangeWatchedFiles((_change) => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
});

/**
 * When hovering over a component name, this functionality tries to figure out what component that is.
 * If mach is found, documentation for that component will be shown.
 * 
 * @params _textDocumentPosition VS Code generated TextDocumentationParams what holds information about what we are hovering over
 * @return hover Object - Hovering object what simply contains the string what will be displayed for the user 
 */
connection.onHover((_textDocumentPosition: TextDocumentPositionParams, _onCancel): Hover => {

	// Initialize hover object what will be returned
	let hover = {
		contents: ""
	}

	// Compile the ContentObject
	let content: ContentObject = {
		content: documents.get(_textDocumentPosition.textDocument.uri).getText(),
		line: _textDocumentPosition.position.line,
		char: _textDocumentPosition.position.character
	}

	// Check what word we are hovering over
	let validateContent = checkWhatWord(content).toLocaleLowerCase()

	// Map through onComplete items and check if hovered value maches anything
	serverCompleteItems.map((item) => {

		if(item.label.toLocaleLowerCase() === validateContent) {
			hover.contents = item.documentation
		}
	})

	return hover;
})

function checkWhatWord(_contentObj: ContentObject): String {
	let givenWord: any[] = [];

	// Calculate what word is hovered over
	_contentObj.content.split("\n").map((line, lineIndex) => {
		if(lineIndex === _contentObj.line) {
			
			let wordDone = false;
			line.split("").map((c, i) => {
				if(wordDone === false) {
					if(givenWord.length === 0) {
						if((c !== "\t" && c !== " ") && i <= _contentObj.char) {
							givenWord.push(c);
						}
					} else {
						if(i < _contentObj.char) {
							if(c === "\t" || c === " "){
								givenWord = [];
							} else {
								givenWord.push(c);
							}
						} else if(c !== " " && i === _contentObj.char) {
							givenWord.push(c)
						} else if(i > _contentObj.char) {
							if(c === "\t" || c === " ") {
								wordDone = true;
							} else {
								givenWord.push(c);
							}
						}
					}
				}
			})
		}
	})
	
	return givenWord.join("");
}

// This handler provides the initial list of the completion items.
connection.onCompletion((_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
	
	let currentContent = documents.get(_textDocumentPosition.textDocument.uri).getText();
	let lines = currentContent.split("\n");
	let char = lines[_textDocumentPosition.position.line].split("");
	let modulesInQuestion: CompletionItem[];

	if(char[_textDocumentPosition.position.character - 1] === ".") {
		modulesInQuestion = [];
		let latest = char.join("");
		serverCompleteItems.map((item) => {
			if(item.label.indexOf(latest) !== -1) {
				modulesInQuestion.push(item);
			}
		})
	} else {
		modulesInQuestion = serverCompleteItems;
	}
	
	return modulesInQuestion;
});

// This handler resolve additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
	//if(item.label.indexOf(".") !== -1) {
	//	let labelArray = item.label.split(".");
	//	item.insertText = labelArray[labelArray.length - 1];
	//}
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
