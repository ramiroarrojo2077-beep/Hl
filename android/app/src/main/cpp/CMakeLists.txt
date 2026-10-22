# Puente JNI entre la app y libnode.so (Node.js para Android, de github.com/digidem/nodejs-mobile).
# libnode.so y sus headers no están en el repo: los baja android/preparar.sh a android/app/libnode/.
cmake_minimum_required(VERSION 3.22.1)
project(gravity_nodo CXX)

# Los headers de Node 24 (V8 13) piden C++20.
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(NODE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../../libnode)
if(NOT EXISTS ${NODE_DIR}/bin/${ANDROID_ABI}/libnode.so)
  message(FATAL_ERROR "Falta ${NODE_DIR}/bin/${ANDROID_ABI}/libnode.so: corré android/preparar.sh")
endif()

# Biblioteca ya compilada: AGP la mete sola en la APK porque gravity_nodo depende de ella.
add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES IMPORTED_LOCATION ${NODE_DIR}/bin/${ANDROID_ABI}/libnode.so)

add_library(gravity_nodo SHARED gravity_nodo.cpp)
target_include_directories(gravity_nodo PRIVATE ${NODE_DIR}/include/node)
target_link_libraries(gravity_nodo node log)
# Alineada a 16 KB para los celulares con páginas de memoria de 16 KB.
target_link_options(gravity_nodo PRIVATE "-Wl,-z,max-page-size=16384")
