package com.jarvis.asistente;

/** Calculadora exacta para la IA (las IA suelen equivocarse con cuentas). */
final class Calculadora {
    private Calculadora() {}

    /**
     * Soporta + - * / % ^ (también ** ), paréntesis, signo (−2^2 = −4), funciones sqrt raiz abs round floor ceil min max sin
     * cos tan log (base 10) ln exp pow, constantes pi y e, × y ÷. Redondea a 10 decimales.
     * @throws IllegalArgumentException con un mensaje en español si la expresión es inválida o el resultado no es finito.
     */
    static double calcular(String expresion) {
        throw new UnsupportedOperationException("pendiente");
    }
}
