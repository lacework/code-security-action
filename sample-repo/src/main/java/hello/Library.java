package hello;

import java.io.File;

public class Library {
	public static void doSomething(String s) {
		execute(s);
	}

	private static void execute(String command) {
		new File(command);
	}
}
