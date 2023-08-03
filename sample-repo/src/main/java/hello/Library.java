package hello;

import java.io.IOException;

public class Library {
	public static void doSomething(String s) {
		execute(s);
	}

	private static void execute(String command) {
		try {
			Runtime.getRuntime().exec(command);
		} catch (IOException e) {
			// do nothing
		}

	}
}
