package com.jarvis.asistente;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Calculadora exacta para la IA (las IA suelen equivocarse con cuentas). */
final class Calculadora {
    private Calculadora() {}

    // Mismos tokens que la versión de PC: números (con exponente), nombres y operadores.
    private static final Pattern TOKEN = Pattern.compile(
            "\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?|[a-záéíóú_]+|[-+*/^%(),]",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    // Los espacios que reconoce \s de JavaScript, para comparar igual que la PC.
    private static final Pattern ESPACIOS = Pattern.compile(
            "[\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+");
    private static final int MAX_LARGO = 2000;
    // Evita desbordar la pila con "((((…" o "-----…" (un StackOverflowError tiraría abajo el hilo).
    private static final int MAX_PROFUNDIDAD = 200;

    /**
     * Soporta + - * / % ^ (también ** ), paréntesis, signo (−2^2 = −4), funciones sqrt raiz abs round floor ceil min max sin
     * cos tan log (base 10) ln exp pow, constantes pi y e, × y ÷. Redondea a 10 decimales.
     * @throws IllegalArgumentException con un mensaje en español si la expresión es inválida o el resultado no es finito.
     */
    static double calcular(String expresion) {
        if (expresion == null) throw new IllegalArgumentException("Expresión inválida.");
        if (expresion.length() > MAX_LARGO) throw new IllegalArgumentException("La expresión es demasiado larga.");
        String fuente = expresion.replace('×', '*').replace('÷', '/').replace('−', '-').replace("**", "^");
        List<String> tokens = new ArrayList<>();
        StringBuilder unidos = new StringBuilder();
        Matcher m = TOKEN.matcher(fuente);
        while (m.find()) {
            tokens.add(m.group());
            unidos.append(m.group());
        }
        // Tokenización estricta: cualquier carácter que no sea parte de un token invalida la expresión.
        if (tokens.isEmpty() || !unidos.toString().equals(ESPACIOS.matcher(fuente).replaceAll(""))) {
            throw new IllegalArgumentException("Expresión inválida.");
        }
        Analizador a = new Analizador(tokens);
        double resultado = a.suma();
        if (a.i != tokens.size()) throw new IllegalArgumentException("Expresión inválida.");
        if (Double.isNaN(resultado) || Double.isInfinite(resultado)) {
            throw new IllegalArgumentException("El resultado no es un número finito.");
        }
        double escalado = resultado * 1e10;
        // Con números enormes el escalado se va a infinito: ahí no hay decimales que redondear.
        double redondeado = Double.isInfinite(escalado) ? resultado : redondear(escalado) / 1e10;
        return redondeado + 0.0; // sin -0
    }

    /** Math.round de JavaScript: al entero más cercano y, en el empate, hacia +∞ (sin pasar por long en números grandes). */
    private static double redondear(double x) {
        if (Double.isNaN(x) || Double.isInfinite(x) || Math.abs(x) >= 4503599627370496.0) return x;
        return (double) Math.round(x);
    }

    /** Parser recursivo descendente, igual que en herramientas.ts. */
    private static final class Analizador {
        private final List<String> tokens;
        int i;
        private int profundidad;

        Analizador(List<String> tokens) {
            this.tokens = tokens;
        }

        private String ver() {
            return i < tokens.size() ? tokens.get(i) : null;
        }

        private String tomar() {
            return i < tokens.size() ? tokens.get(i++) : null;
        }

        private void tomar(String esperado) {
            String t = i < tokens.size() ? tokens.get(i) : null;
            i++;
            if (!esperado.equals(t)) throw new IllegalArgumentException("Se esperaba \"" + esperado + "\".");
        }

        double suma() {
            double v = producto();
            while ("+".equals(ver()) || "-".equals(ver())) {
                v = "+".equals(tomar()) ? v + producto() : v - producto();
            }
            return v;
        }

        private double producto() {
            double v = unario();
            while ("*".equals(ver()) || "/".equals(ver()) || "%".equals(ver())) {
                String op = tomar();
                double d = unario();
                v = "*".equals(op) ? v * d : "/".equals(op) ? v / d : v % d;
            }
            return v;
        }

        // El signo va antes que la potencia: -2^2 da -4.
        private double unario() {
            if (++profundidad > MAX_PROFUNDIDAD) throw new IllegalArgumentException("La expresión es demasiado larga.");
            try {
                if ("-".equals(ver())) {
                    tomar();
                    return -unario();
                }
                if ("+".equals(ver())) {
                    tomar();
                    return unario();
                }
                return potencia();
            } finally {
                profundidad--;
            }
        }

        // Asociativa a derecha: 2^3^2 = 2^9.
        private double potencia() {
            double base = primario();
            if (!"^".equals(ver())) return base;
            tomar();
            return Math.pow(base, unario());
        }

        private double primario() {
            String t = tomar();
            if (t == null) throw new IllegalArgumentException("Expresión incompleta.");
            if (t.equals("(")) {
                double v = suma();
                tomar(")");
                return v;
            }
            char primero = t.charAt(0);
            if (primero >= '0' && primero <= '9') {
                try {
                    return Double.parseDouble(t);
                } catch (NumberFormatException e) {
                    throw new IllegalArgumentException("Expresión inválida.");
                }
            }
            String nombre = t.toLowerCase(Locale.ROOT);
            if (nombre.equals("pi")) return Math.PI;
            if (nombre.equals("e")) return Math.E;
            if (!esFuncion(nombre)) throw new IllegalArgumentException("No conozco \"" + t + "\".");
            tomar("(");
            List<Double> args = new ArrayList<>();
            args.add(suma());
            while (",".equals(ver())) {
                tomar();
                args.add(suma());
            }
            tomar(")");
            return aplicar(nombre, args);
        }
    }

    private static boolean esFuncion(String nombre) {
        switch (nombre) {
            case "sqrt": case "raiz": case "raíz": case "abs": case "round": case "floor": case "ceil": case "min":
            case "max": case "sin": case "cos": case "tan": case "log": case "ln": case "exp": case "pow":
                return true;
            default:
                return false;
        }
    }

    // Como en JavaScript: los argumentos de más se ignoran y los que faltan valen NaN.
    private static double arg(List<Double> args, int i) {
        return i < args.size() ? args.get(i) : Double.NaN;
    }

    private static double aplicar(String nombre, List<Double> args) {
        double x = arg(args, 0);
        switch (nombre) {
            case "sqrt": case "raiz": case "raíz": return Math.sqrt(x);
            case "abs": return Math.abs(x);
            case "round": return redondear(x);
            case "floor": return Math.floor(x);
            case "ceil": return Math.ceil(x);
            case "min": {
                double v = x;
                for (int j = 1; j < args.size(); j++) v = Math.min(v, args.get(j));
                return v;
            }
            case "max": {
                double v = x;
                for (int j = 1; j < args.size(); j++) v = Math.max(v, args.get(j));
                return v;
            }
            case "sin": return Math.sin(x);
            case "cos": return Math.cos(x);
            case "tan": return Math.tan(x);
            case "log": return Math.log10(x);
            case "ln": return Math.log(x);
            case "exp": return Math.exp(x);
            case "pow": return Math.pow(x, arg(args, 1));
            default: throw new IllegalArgumentException("No conozco \"" + nombre + "\".");
        }
    }
}
