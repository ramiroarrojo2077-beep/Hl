package ar.gravity.app

/** Node.js embebido (libnode.so de nodejs-mobile). Solo se usa desde el proceso ":motor". */
object NodeNativo {
    init {
        System.loadLibrary("c++_shared")
        System.loadLibrary("node")
        System.loadLibrary("gravity_nodo")
    }

    /**
     * Corre Node con esos argumentos (el primero es "node") hasta que el motor termina, y devuelve
     * el código de salida. stdout y stderr van al archivo [registro] y el directorio de trabajo
     * pasa a ser [carpeta]. Una sola vez por proceso.
     */
    @JvmStatic
    external fun iniciar(argumentos: Array<String>, registro: String, carpeta: String): Int
}
