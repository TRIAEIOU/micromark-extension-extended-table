/**
 * @typedef {import('micromark-util-types').Extension} Extension
 * @typedef {import('micromark-util-types').Resolver} Resolver
 * @typedef {import('micromark-util-types').Tokenizer} Tokenizer
 * @typedef {import('micromark-util-types').State} State
 * @typedef {import('micromark-util-types').Token} Token
 * @typedef {import('micromark-util-types').Code} Code
 */
/**
 * @typedef {'left'|'center'|'right'|'none'} Align
 */
import { ok as assert } from 'uvu/assert';
import { markdownLineEnding, markdownSpace } from 'micromark-util-character';
import { codes } from 'micromark-util-symbol/codes.js';
import { constants } from 'micromark-util-symbol/constants.js';
import { types } from 'micromark-util-symbol/types.js';
/**
 * Syntax extension for micromark (passed in `extensions`).
 *
 * @type {Extension}
 */
export const extendedTable = {
    // @ts-ignore - FIXME: why does this all of a sudden cause typing error?
    flow: { null: { tokenize: tokenizeTable, resolve: resolveTable } }
};
/**
 * @param {Code} code
 * @returns {boolean}
 */
function markdownTableCellContent(code) {
    return !markdownSpace(code) && code !== codes.verticalBar && !markdownLineEnding(code) && code !== codes.eof;
}
/** @type {Resolver} */
// eslint-disable-next-line complexity
function resolveTable(events, context) {
    let index = -1;
    /** @type {boolean|undefined} */
    let inHead;
    /** @type {boolean|undefined} */
    let inDelimiterRow;
    /** @type {boolean|undefined} */
    let inRow;
    /** @type {number|undefined} */
    let contentStart;
    /** @type {number|undefined} */
    let contentEnd;
    /** @type {number|undefined} */
    let cellStart;
    /** @type {boolean|undefined} */
    let seenCellInRow;
    while (++index < events.length) {
        const token = events[index][1];
        if (inRow) {
            if (token.type === 'temporaryTableCellContent') {
                contentStart = contentStart || index;
                contentEnd = index;
            }
            if (
            // Combine separate content parts into one.
            (token.type === 'tableCellDivider' || token.type === 'tableRow' || token.type === 'tableHeaderRow') &&
                contentEnd) {
                assert(contentStart, 'expected `contentStart` to be defined if `contentEnd` is');
                const content = {
                    type: 'tableContent',
                    start: events[contentStart][1].start,
                    end: events[contentEnd][1].end
                };
                /** @type {Token} */
                const text = {
                    type: types.chunkText,
                    start: content.start,
                    end: content.end,
                    // @ts-expect-error It’s fine.
                    contentType: constants.contentTypeText
                };
                assert(contentStart, 'expected `contentStart` to be defined if `contentEnd` is');
                events.splice(contentStart, contentEnd - contentStart + 1, ['enter', content, context], ['enter', text, context], ['exit', text, context], ['exit', content, context]);
                index -= contentEnd - contentStart - 3;
                contentStart = undefined;
                contentEnd = undefined;
            }
        }
        if (events[index][0] === 'exit' &&
            cellStart !== undefined &&
            cellStart + (seenCellInRow ? 0 : 1) < index &&
            (token.type === 'tableCellDivider' ||
                ((token.type === 'tableRow' || token.type === 'tableHeaderRow') &&
                    (cellStart + 3 < index ||
                        events[cellStart][1].type !== types.whitespace)))) {
            const cell = {
                type: inDelimiterRow
                    ? 'tableDelimiter'
                    : inHead
                        ? 'tableHeader'
                        : 'tableData',
                start: events[cellStart][1].start,
                end: events[index][1].end
            };
            events.splice(index + (token.type === 'tableCellDivider' ? 1 : 0), 0, [
                'exit',
                cell,
                context
            ]);
            events.splice(cellStart, 0, ['enter', cell, context]);
            index += 2;
            cellStart = index + 1;
            seenCellInRow = true;
        }
        if (token.type === 'tableRow' || token.type === 'tableHeaderRow') {
            inRow = events[index][0] === 'enter';
            if (inRow) {
                cellStart = index + 1;
                seenCellInRow = false;
            }
        }
        if (token.type === 'tableDelimiterRow') {
            inDelimiterRow = events[index][0] === 'enter';
            if (inDelimiterRow) {
                cellStart = index + 1;
                seenCellInRow = false;
            }
        }
        if (token.type === 'tableHead') {
            inHead = events[index][0] === 'enter';
        }
    }
    return events;
}
/***********************************************
 * Create tokenizer for entire table (will use subtokenizers
 * for header, delimiter and body rows
 * @type {Tokenizer}
 */
function tokenizeTable(effects, ok, nok) {
    let self = this;
    // Need to save these to call in right scope
    self.nok = nok;
    self.ok = ok;
    /** @type {Array<Align>} */
    const align = [];
    /** @type {number} */
    let lastColCount; // # of cols in last header or body row (not delimiter)
    /** @type {'gfm'|'delimiter'|'body'|undefined} */
    let tableType;
    return tableStart;
    /**
     * Attempt to tokenize as GFM-table, then headerless table with and
     * delimiter/alignment, then table body only
     * @type {State}
     */
    function tableStart(code) {
        // @ts-ignore
        effects.enter('table')._align = align;
        return effects.attempt([
            { tokenize: tokenizeHeader, partial: true },
            { tokenize: tokenizeDelimiter, partial: true },
            { tokenize: tokenizeBody, partial: true },
        ], function (code) {
            self.ok = ok;
            self.nok = nok;
            return tableClose(code);
        }, nok // No table pattern found
        )(code);
    }
    /**
     * Create tokenizer for header row
     * @type {Tokenizer}
     */
    function tokenizeHeader(effects, ok, nok) {
        // @ts-ignore
        self = this; // Has to be set as tokenizers are called with an object
        self.nok = nok;
        self.ok = ok;
        align.length = 0;
        tableType = 'gfm';
        return header;
    }
    /***********************************************
     * Tokenize line as head, chain to delimiter row if successful or nok()
     * @type {State}
     */
    function header(code) {
        effects.enter('tableHead');
        effects.enter('tableHeaderRow');
        return nonDelimiterRow(rowEnd, code);
        /***********************************************
        * End of head row - close and check that table is not
        * interrupted on next line then chain to delimiter row
        * @type {State}
        */
        function rowEnd(code) {
            // No cols found (i.e. not a table) or eof (header only tables not allowed)
            if (!lastColCount || code === codes.eof) {
                return self.nok(code);
            }
            effects.exit('tableHeaderRow');
            effects.exit('tableHead');
            effects.enter(types.lineEnding);
            effects.consume(code);
            effects.exit(types.lineEnding);
            return nextLine;
            /** @type {State} */
            function nextLine(code) {
                if (tableContinues(self, code)) {
                    return delimiter(code);
                }
                return self.nok(code); // No header row only tables
            }
        }
    }
    /** @type {Tokenizer} */
    function tokenizeDelimiter(effects, ok, nok) {
        // @ts-ignore
        self = this; // Has to be set as tokenizers are called with an object
        self.nok = nok;
        self.ok = ok;
        align.length = 0;
        tableType = 'delimiter';
        return delimiter;
    }
    /** @type {State} */
    function delimiter(code) {
        /** @type {Align} */
        let _align = 'none';
        effects.enter('tableDelimiterRow');
        if (code === codes.verticalBar) {
            return divider(code);
        }
        return cellStart(code);
        /***********************************************
         * Tokenize and consume divider, continue to space or line end
         * @type {State}
         */
        function divider(code) {
            effects.enter('tableCellDivider');
            effects.consume(code);
            effects.exit('tableCellDivider');
            return cellStart;
        }
        /***********************************************
         * Tokenize any left space and continue to content
         * @type {State}
         */
        function cellStart(code) {
            if (markdownLineEnding(code) || code === codes.eof) {
                return rowEnd(code);
            }
            if (markdownSpace(code)) {
                effects.enter(types.whitespace);
                return eatSpace(code);
            }
            return contentStart(code);
            /** @type {State} */
            function eatSpace(code) {
                if (markdownSpace(code)) {
                    effects.consume(code);
                    return eatSpace;
                }
                effects.exit(types.whitespace);
                return cellStart(code);
            }
        }
        /** @type {State} */
        function contentStart(code) {
            if (code === codes.dash) {
                _align = 'none';
                return fillerStart(code);
            }
            if (code === codes.colon) {
                effects.enter('tableDelimiterAlignment');
                effects.consume(code);
                effects.exit('tableDelimiterAlignment');
                _align = 'left';
                return fillerStart;
            }
            return self.nok(code);
        }
        /** @type {State} */
        function fillerStart(code) {
            if (code === codes.dash) {
                effects.enter('tableDelimiterFiller');
                effects.consume(code);
                return eatFiller;
            }
            return self.nok(code);
            /** @type {State} */
            function eatFiller(code) {
                if (code === codes.dash) {
                    effects.consume(code);
                    return eatFiller;
                }
                effects.exit('tableDelimiterFiller');
                return fillerEnd(code);
            }
        }
        /** @type {State} */
        function fillerEnd(code) {
            if (code === codes.colon) {
                effects.enter('tableDelimiterAlignment');
                effects.consume(code);
                _align = _align === 'left' ? 'center' : 'right';
                effects.exit('tableDelimiterAlignment');
                return contentEnd;
            }
            return contentEnd(code);
        }
        /** @type {State} */
        function contentEnd(code) {
            return cellEnd(code);
        }
        /** @type {State} */
        function cellEnd(code) {
            if (markdownSpace(code)) {
                effects.enter(types.whitespace);
                return eatSpace(code);
            }
            align.push(_align);
            if (markdownLineEnding(code) || code === codes.eof) {
                return rowEnd(code);
            }
            if (code === codes.verticalBar) {
                return divider(code);
            }
            return self.nok(code);
            /** @type {State} */
            function eatSpace(code) {
                if (markdownSpace(code)) {
                    effects.consume(code);
                    return eatSpace;
                }
                effects.exit(types.whitespace);
                return cellEnd(code);
            }
        }
        /***********************************************
        * End of delimiter row - close and check that delimiters match
        * cols if GFM format
        * @type {State}
        */
        function rowEnd(code) {
            if (!lastColCount && code === codes.eof)
                return self.nok(code);
            if (lastColCount && lastColCount !== align.length)
                return self.nok(code);
            effects.exit('tableDelimiterRow');
            effects.enter(types.lineEnding);
            effects.consume(code);
            effects.exit(types.lineEnding);
            return nextLine;
            /** @type {State} */
            function nextLine(code) {
                if (tableContinues(self, code))
                    return body(code);
                return lastColCount ? self.ok(code) : self.nok(code);
            }
        }
    }
    /** @type {Tokenizer} */
    function tokenizeBody(effects, ok, nok) {
        // @ts-ignore
        self = this; // Has to be set as tokenizers are called with an object
        self.nok = nok;
        self.ok = ok;
        align.length = 0;
        tableType = 'body';
        return body;
    }
    /** @type {State} */
    function body(code) {
        effects.enter('tableBody');
        return bodyRow(code);
    }
    /***********************************************
     * Tokenize line as body
     * @type {State}
     */
    function bodyRow(code) {
        effects.enter('tableRow');
        return nonDelimiterRow(rowEnd, code);
        /***********************************************
        * End of body row - close and check that table is not
        * interrupted on next line
        * @type {State}
        */
        function rowEnd(code) {
            effects.exit('tableRow');
            if (!lastColCount)
                return self.nok(code);
            if (tableType === 'body') {
                while (lastColCount > align.length)
                    align.push('none');
            }
            if (code === codes.eof)
                return bodyClose(code);
            effects.enter(types.lineEnding);
            effects.consume(code);
            effects.exit(types.lineEnding);
            return nextLine;
            /** @type {State} */
            function nextLine(code) {
                if (tableContinues(self, code)) {
                    return bodyRow(code);
                }
                return bodyClose(code);
            }
        }
        /** @type {State} */
        function bodyClose(code) {
            effects.exit('tableBody');
            return self.ok(code);
        }
    }
    /***********************************************
     * Tokenize header or body row (row internal logic is identical)
     * @param {State} rowEnd function to be called at end of row
     * @param {Code} code first code in row
     * @returns {void|State}
     */
    function nonDelimiterRow(rowEnd, code) {
        let leadingDivider = 0; // 0 or 1 leading dividers
        let dividerCount = 0; // total # of dividers
        let trailingDivider = 0; // 0 or 1 trailing dividers
        if (code === codes.verticalBar) {
            leadingDivider = 1;
            return divider(code);
        }
        return cell(code);
        /***********************************************
         * Tokenize and consume divider, continue to cell start
         * @type {State}
         */
        function divider(code) {
            effects.enter('tableCellDivider');
            effects.consume(code);
            effects.exit('tableCellDivider');
            dividerCount++;
            trailingDivider = 1; // Set to 0 when nonWhitespace discovered in cell
            return cell;
        }
        /***********************************************
         * Tokenize any left space and continue to content
         * @type {State}
         */
        function cell(code) {
            if (code === codes.verticalBar || markdownLineEnding(code) || code === codes.eof) {
                return cellEnd(code);
            }
            if (markdownSpace(code)) {
                effects.enter(types.whitespace);
                return eatSpace(code);
            }
            trailingDivider = 0;
            effects.enter('temporaryTableCellContent');
            if (code === codes.backslash) {
                effects.consume(code);
                return eatEscapedContent;
            }
            return eatContent(code);
            /** @type {State} */
            function eatSpace(code) {
                if (markdownSpace(code)) {
                    effects.consume(code);
                    return eatSpace;
                }
                effects.exit(types.whitespace);
                return cell(code);
            }
            /** @type {State} */
            function eatContent(code) {
                if (markdownTableCellContent(code)) {
                    effects.consume(code);
                    return eatContent;
                }
                effects.exit('temporaryTableCellContent');
                return cell(code);
            }
            /** @type {State} */
            function eatEscapedContent(code) {
                if (code === codes.backslash || code === codes.verticalBar) {
                    effects.consume(code);
                    return eatContent;
                }
                return eatContent(code);
            }
        }
        /**
         * End of cell, continue to next
         * @type {State}
         */
        function cellEnd(code) {
            if (markdownLineEnding(code) || code === codes.eof) {
                lastColCount = dividerCount > (leadingDivider + trailingDivider) || (leadingDivider && trailingDivider)
                    ? lastColCount = dividerCount + 1 - (leadingDivider + trailingDivider)
                    : 0;
                return rowEnd(code);
            }
            return divider(code);
        }
    }
    /***********************************************
     * Close table and return self.ok()
     * @type {State}
     */
    function tableClose(code) {
        effects.exit('table');
        return self.ok(code);
    }
    /***********************************************
     * Tokenize line ending and return whether the table continues.
     * @param {*} self
     * @param {Code} code
     * @returns {Boolean}
     */
    function tableContinues(self, code) {
        // Blank lines interrupts table (and can have no chars).
        if (self.parser.lazy[self.now().line] || markdownLineEnding(code) || code === codes.eof) {
            return false;
        }
        // Indented code interrupts table.
        const tail = self.events[self.events.length - 1];
        if (!self.parser.constructs.disable.null.includes('codeIndented')
            && tail
            && tail[1].type === types.linePrefix
            && tail[2].sliceSerialize(tail[1], true).length >= constants.tabSize) {
            return false;
        }
        // Block level constructs interupts table
        if (self.parser.constructs.flow?.code) {
            return false;
        }
        return true;
    }
}
