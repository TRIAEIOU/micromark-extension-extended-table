import test from 'tape'
import {micromark} from 'micromark'
import {xtable as syntax, xtableHtml as html} from '../dev/index.js'

test('markdown -> html (micromark)', (t) => {
  t.deepEqual(
    micromark('|0|\n|-|\n|1|\n\n\n|-|\n|2|', {
      extensions: [syntax],
      htmlExtensions: [html]
    }),
    '<table>\n<thead>\n<tr>\n<th>a</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>b</td>\n</tr>\n</tbody>\n</table>',
    'should support a table w/ a body row ending in an eof (1)'
  )

  t.end()
})
