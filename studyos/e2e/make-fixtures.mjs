// Genera un PDF de química de 2 páginas para las pruebas.
import { jsPDF } from 'jspdf';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
const d = new jsPDF();
d.setFontSize(20);
d.text('Estequiometría', 20, 25);
d.setFontSize(12);
d.text(d.splitTextToSize('La estequiometría estudia las proporciones en que reaccionan las sustancias. Un mol contiene 6,022 x 10^23 partículas. La masa molar del agua es 18 g/mol.', 170), 20, 40);
d.addPage();
d.setFontSize(20);
d.text('Enlaces químicos', 20, 25);
d.setFontSize(12);
d.text(d.splitTextToSize('Los enlaces covalentes se forman al compartir electrones. El enlace iónico ocurre entre metales y no metales, como en el cloruro de sodio.', 170), 20, 40);
writeFileSync(new URL('./fixtures/quimica.pdf', import.meta.url), Buffer.from(d.output('arraybuffer')));
console.log('fixtures/quimica.pdf');
