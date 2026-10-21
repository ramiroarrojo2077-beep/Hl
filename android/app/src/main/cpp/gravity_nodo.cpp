// Arranca Node.js dentro del proceso de la app. node::Start bloquea el hilo hasta que el motor
// termina y solo se puede llamar una vez por proceso: por eso corre en el proceso aparte ":motor".
#include <jni.h>

#include <fcntl.h>
#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "node.h"

extern "C" JNIEXPORT jint JNICALL
Java_ar_gravity_app_NodeNativo_iniciar(JNIEnv* env, jclass, jobjectArray argumentos, jstring registro, jstring carpeta) {
  // En Android el directorio de trabajo es "/": las rutas relativas tienen que caer en los datos de Gravity.
  const char* directorio = env->GetStringUTFChars(carpeta, nullptr);
  chdir(directorio);
  env->ReleaseStringUTFChars(carpeta, directorio);

  // Android tira stdout y stderr: lo que imprima el motor va al archivo de registro.
  const char* ruta = env->GetStringUTFChars(registro, nullptr);
  int fd = open(ruta, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0600);
  env->ReleaseStringUTFChars(registro, ruta);
  if (fd >= 0) {
    dup2(fd, STDOUT_FILENO);
    dup2(fd, STDERR_FILENO);
    close(fd);
  }
  setvbuf(stdout, nullptr, _IONBF, 0);
  setvbuf(stderr, nullptr, _IONBF, 0);

  const jsize cantidad = env->GetArrayLength(argumentos);
  std::vector<std::string> copias;
  size_t total = 0;
  for (jsize i = 0; i < cantidad; i++) {
    auto texto = static_cast<jstring>(env->GetObjectArrayElement(argumentos, i));
    const char* c = env->GetStringUTFChars(texto, nullptr);
    copias.emplace_back(c);
    env->ReleaseStringUTFChars(texto, c);
    env->DeleteLocalRef(texto);
    total += copias.back().size() + 1;
  }

  // libuv reescribe argv en el lugar: los argumentos tienen que estar en un solo bloque de memoria.
  // No se libera nunca: Node guarda los punteros mientras corre.
  char* bloque = static_cast<char*>(calloc(total, 1));
  char** argv = static_cast<char**>(calloc(cantidad + 1, sizeof(char*)));
  char* p = bloque;
  for (jsize i = 0; i < cantidad; i++) {
    memcpy(p, copias[i].c_str(), copias[i].size() + 1);
    argv[i] = p;
    p += copias[i].size() + 1;
  }
  return static_cast<jint>(node::Start(static_cast<int>(cantidad), argv));
}
