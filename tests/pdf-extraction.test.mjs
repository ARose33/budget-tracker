import test from "node:test";
import assert from "node:assert/strict";
import {extractPdfBytes,MAX_PDF_BYTES} from "../src/lib/statements/pdf.ts";
import {parseStatementText} from "../src/lib/statements/parser.ts";
// Minimal synthetic PDF byte fixture, generated entirely in memory; no private documents.
function pdfFixture(pages){
 const objects=["<< /Type /Catalog /Pages 2 0 R >>","", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
 const kids=[];
 for(const lines of pages){
  const pageId=objects.length+1,streamId=pageId+1;
  kids.push(pageId+" 0 R");
  objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents "+streamId+" 0 R >>");
  const text=lines.map((line,i)=>"BT /F1 10 Tf 1 0 0 1 40 "+(740-i*20)+" Tm ("+line.replace(/[\\()]/g,"\\$&")+") Tj ET").join("\n");
  objects.push("<< /Length "+Buffer.byteLength(text)+" >>\nstream\n"+text+"\nendstream");
 }
 objects[1]="<< /Type /Pages /Count "+pages.length+" /Kids ["+kids.join(" ")+"] >>";
 let output="%PDF-1.4\n";const offsets=[0];
 objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(output));output+=(i+1)+" 0 obj\n"+obj+"\nendobj\n";});
 const start=Buffer.byteLength(output);
 output+="xref\n0 "+offsets.length+"\n0000000000 65535 f \n"+offsets.slice(1).map(offset=>String(offset).padStart(10,"0")+" 00000 n \n").join("");
 output+="trailer\n<< /Size "+offsets.length+" /Root 1 0 R >>\nstartxref\n"+start+"\n%%EOF\n";
 return new Uint8Array(Buffer.from(output));
}
test("real PDF extraction keeps page/row order and parses synthetic purchases and payments in the selected year",async()=>{
 const doc=await extractPdfBytes(pdfFixture([["CHASE Freedom Unlimited","Opening/Closing Date 08/15/26 - 09/14/26","08/20 08/21 SYNTHETIC GROCER 54.32"],["09/02 09/03 PAYMENT THANK YOU 100.00"]]));
 assert.equal(doc.pageCount,2);assert.equal(doc.pages[1].pageNumber,2);
 const result=parseStatementText(doc.pages.flatMap(page=>page.lines.map(line=>line.text)),{targetYear:2026,accountTypeHint:"credit_card"});
 assert.deepEqual(result.transactions.map(row=>({date:row.date,amount:row.amount})),[{date:"2026-08-20",amount:-54.32},{date:"2026-09-02",amount:100}]);
 assert.equal(parseStatementText(doc.text.split("\n"),{targetYear:2023,accountTypeHint:"credit_card"}).transactions.length,0);
});
test("PDF extraction rejects invalid, oversized and overlong inputs, and reports a textless page without inventing rows",async()=>{
 await assert.rejects(extractPdfBytes(new Uint8Array([0,1,2])),/header/);
 await assert.rejects(extractPdfBytes(new Uint8Array(MAX_PDF_BYTES+1)),/15 MB/);
 await assert.rejects(extractPdfBytes(pdfFixture(Array.from({length:101},()=>[]))),/100 pages/);
 assert.equal((await extractPdfBytes(pdfFixture([[]]))).text,"");
});
