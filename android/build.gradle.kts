// Versiones fijas, elegidas para funcionar juntas:
// - Android Gradle Plugin 9.3.3 (pide Gradle 9.5.0 o más y JDK 17 o más; compila hasta API 37).
//   compileSdk 37 y targetSdk 36: ver app/build.gradle.kts (permiso de red local de Android 17).
// - Gradle 9.5.1 (lo instala la CI con gradle/actions/setup-gradle; ver gradle/wrapper/gradle-wrapper.properties).
// - Kotlin 2.4.21: AGP 9 compila Kotlin solo ("built-in Kotlin"), así que NO se aplica
//   org.jetbrains.kotlin.android. Esta línea solo fija la versión del Kotlin Gradle Plugin
//   que usa AGP, como indica la guía oficial de AGP 9.0.
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")
    }
}

plugins {
    id("com.android.application") version "9.3.3" apply false
}
