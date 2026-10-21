// Gravity para Android, todo en uno: el motor (Node.js) corre dentro del celular.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "Gravity"
include(":app")
